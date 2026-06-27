const https = require("https");

const PUMP_URL = "https://frontend-api-v3.pump.fun/coins";
const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const KOLSCAN_URL = "https://kolscan.io/leaderboard";
const X_READER_URL = "https://r.jina.ai/http://r.jina.ai/http://https://twitter.com/";

let pumpCache = null;
let pumpCacheAt = 0;
let kolscanCache = null;
let kolscanCacheAt = 0;
const tweetCache = new Map();

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function txns(pair, windowKey) {
  const source = pair.txns?.[windowKey] || {};
  const buys = source.buys || 0;
  const sells = source.sells || 0;
  return { buys, sells, trades: buys + sells };
}

function volume(pair, windowKey) {
  return pair.volume?.[windowKey] || 0;
}

function emptyWindowMap() {
  return {
    m5: { volume: 0, buys: 0, sells: 0, trades: 0 },
    h1: { volume: 0, buys: 0, sells: 0, trades: 0 },
    h24: { volume: 0, buys: 0, sells: 0, trades: 0 }
  };
}

function addTotals(target, source, windowKey) {
  const t = txns(source, windowKey);
  target.volume += volume(source, windowKey);
  target.buys += t.buys;
  target.sells += t.sells;
  target.trades += t.trades;
}

function windowStart(now, windowKey) {
  const spans = { m5: 5 * 60 * 1000, h1: 60 * 60 * 1000, h24: 24 * 60 * 60 * 1000 };
  return now - spans[windowKey];
}

function isLocalTlsInterception(error) {
  const message = String(error.cause?.message || error.message || "");
  return message.includes("self-signed certificate") || message.includes("issuer certificate");
}

async function fetchJson(url) {
  const href = String(url);
  try {
    const res = await fetch(href, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PYRORA dashboard" }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  } catch (error) {
    if (new URL(href).protocol === "https:" && isLocalTlsInterception(error)) {
      return fetchJsonWithRelaxedTls(href);
    }
    throw error;
  }
}

function fetchJsonWithRelaxedTls(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      agent: new https.Agent({ rejectUnauthorized: false }),
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 PYRORA dashboard" },
      timeout: 20_000
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${res.statusCode} ${res.statusMessage}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}

async function fetchText(url) {
  const href = String(url);
  try {
    const res = await fetch(href, {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,*/*",
        "user-agent": "Mozilla/5.0 PYRORA dashboard"
      }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.text();
  } catch (error) {
    if (new URL(href).protocol === "https:" && isLocalTlsInterception(error)) {
      return fetchTextWithRelaxedTls(href);
    }
    throw error;
  }
}

function fetchTextWithRelaxedTls(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      agent: new https.Agent({ rejectUnauthorized: false }),
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,*/*",
        "user-agent": "Mozilla/5.0 PYRORA dashboard"
      },
      timeout: 20_000
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${res.statusCode} ${res.statusMessage}`));
          return;
        }
        resolve(body);
      });
    });
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
  });
}

function aggregatePairsForMint(pairs, mint) {
  const mintPairs = pairs
    .filter(pair => pair.chainId === "solana" && pair.baseToken?.address === mint)
    .filter(pair => pair.volume || pair.txns);

  const aggregate = {
    volume: {},
    txns: {},
    protocols: Object.fromEntries(["m5", "h1", "h24"].map(key => [key, new Map()])),
    pairCount: mintPairs.length,
    pairCreatedAt: mintPairs.map(pair => pair.pairCreatedAt).filter(Boolean).sort((a, b) => a - b)[0],
    url: mintPairs.sort((a, b) => volume(b, "h24") - volume(a, "h24"))[0]?.url
  };

  for (const key of ["m5", "h1", "h24"]) {
    aggregate.volume[key] = 0;
    aggregate.txns[key] = { buys: 0, sells: 0 };
  }

  for (const pair of mintPairs) {
    const protocol = pair.dexId || "unknown";
    for (const key of ["m5", "h1", "h24"]) {
      const pairTxns = txns(pair, key);
      aggregate.volume[key] += volume(pair, key);
      aggregate.txns[key].buys += pairTxns.buys;
      aggregate.txns[key].sells += pairTxns.sells;

      const current = aggregate.protocols[key].get(protocol) || { label: protocol, volume: 0, count: 0 };
      current.volume += volume(pair, key);
      current.count += 1;
      aggregate.protocols[key].set(protocol, current);
    }
  }

  return aggregate;
}

async function loadPumpVolume(limit) {
  const now = Date.now();
  if (pumpCache && now - pumpCacheAt < 10_000 && pumpCache.limit === limit) return pumpCache.data;

  const pumpUrl = new URL(PUMP_URL);
  pumpUrl.searchParams.set("offset", "0");
  pumpUrl.searchParams.set("limit", String(limit));
  pumpUrl.searchParams.set("sort", "last_trade_timestamp");
  pumpUrl.searchParams.set("order", "DESC");
  pumpUrl.searchParams.set("includeNsfw", "false");

  const coins = await fetchJson(pumpUrl);
  const mints = [...new Set(coins.map(coin => coin.mint).filter(Boolean))];
  const pairChunks = await Promise.all(chunk(mints, 30).map(group => fetchJson(DEX_URL + group.join(","))));
  const pairs = pairChunks.flat();
  const windows = ["m5", "h1", "h24"];

  const tokens = coins.map(coin => {
    const aggregate = aggregatePairsForMint(pairs, coin.mint);
    return {
      mint: coin.mint,
      symbol: coin.symbol?.trim() || coin.name || "UNKNOWN",
      name: coin.name,
      complete: Boolean(coin.complete),
      createdTimestamp: coin.created_timestamp,
      graduationTimestamp: aggregate.pairCreatedAt,
      protocol: coin.protocol || "pump",
      url: aggregate.url || `https://pump.fun/coin/${coin.mint}`,
      pairCount: aggregate.pairCount,
      volume: aggregate.volume,
      txns: aggregate.txns,
      protocols: Object.fromEntries(windows.map(key => [key, [...aggregate.protocols[key].values()]]))
    };
  }).filter(token => token.pairCount > 0);

  const totals = emptyWindowMap();
  const protocols = Object.fromEntries(windows.map(key => [key, new Map()]));
  const graduations = Object.fromEntries(windows.map(key => [key, { count: 0, tokens: [] }]));

  for (const token of tokens) {
    for (const key of windows) {
      addTotals(totals[key], token, key);
      for (const protocolRow of token.protocols[key] || []) {
        const current = protocols[key].get(protocolRow.label) || { label: protocolRow.label, volume: 0, count: 0 };
        current.volume += protocolRow.volume;
        current.count += protocolRow.count;
        protocols[key].set(protocolRow.label, current);
      }
      if (token.complete && token.graduationTimestamp && token.graduationTimestamp >= windowStart(now, key)) {
        graduations[key].count += 1;
        graduations[key].tokens.push({
          mint: token.mint,
          symbol: token.symbol,
          volume: volume(token, key),
          trades: txns(token, key).trades,
          graduatedAt: token.graduationTimestamp,
          url: token.url
        });
      }
    }
  }

  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const data = {
    source: "pump.fun frontend-api-v3 + DEX Screener all token pairs",
    fetchedAt: new Date().toISOString(),
    tokensSampled: tokens.length,
    graduated: tokens.filter(token => token.complete).length,
    created24h: tokens.filter(token => token.createdTimestamp >= oneDayAgo).length,
    totals,
    graduations: Object.fromEntries(windows.map(key => [key, {
      count: graduations[key].count,
      tokens: graduations[key].tokens.sort((a, b) => b.graduatedAt - a.graduatedAt)
    }])),
    protocols: Object.fromEntries(windows.map(key => [key, [...protocols[key].values()].sort((a, b) => b.volume - a.volume)])),
    tokens
  };

  pumpCache = { limit, data };
  pumpCacheAt = now;
  return data;
}

function decodeNextDataStream(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;
  let match;
  while ((match = re.exec(html))) chunks.push(JSON.parse(`"${match[1]}"`));
  return chunks.join("");
}

function parseInitLeaderboard(rsc) {
  const marker = "\"initLeaderboard\":";
  const start = rsc.indexOf(marker);
  if (start === -1) return [];
  const arrayStart = start + marker.length;
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let i = arrayStart; i < rsc.length; i += 1) {
    const ch = rsc[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "[") depth += 1;
    if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) return [];
  return JSON.parse(rsc.slice(arrayStart, end));
}

function getTwitterHandle(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.pathname.split("/").filter(Boolean)[0] || null;
  } catch {
    return null;
  }
}

async function loadKolscanLeaderboard(timeframe = 1, limit = 10) {
  const now = Date.now();
  if (kolscanCache && now - kolscanCacheAt < 60_000 && kolscanCache.timeframe === timeframe && kolscanCache.limit === limit) {
    return kolscanCache.data;
  }

  const html = await fetchText(KOLSCAN_URL);
  const rows = parseInitLeaderboard(decodeNextDataStream(html))
    .filter(row => row.timeframe === timeframe)
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      name: row.name || "Unknown",
      wallet: row.wallet_address,
      walletShort: row.wallet_address ? row.wallet_address.slice(0, 6) : "--",
      profileUrl: row.wallet_address ? `https://kolscan.io/account/${row.wallet_address}?timeframe=${timeframe}` : KOLSCAN_URL,
      avatarUrl: row.wallet_address ? `https://cdn.kolscan.io/profiles/${row.wallet_address}.png` : null,
      twitterUrl: row.twitter || null,
      twitterHandle: getTwitterHandle(row.twitter),
      telegramUrl: row.telegram || null,
      profitSol: Number(row.profit) || 0,
      wins: Number(row.wins) || 0,
      losses: Number(row.losses) || 0
    }));

  const data = { source: "KOLScan public leaderboard page", fetchedAt: new Date().toISOString(), timeframe, rows };
  kolscanCache = { timeframe, limit, data };
  kolscanCacheAt = now;
  return data;
}

function tweetTimestampFromSnowflake(id) {
  try {
    return Number((BigInt(id) >> 22n) + 1288834974657n);
  } catch {
    return 0;
  }
}

function cleanTweetMarkdown(text) {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\(blob:[^)]+\)/g, " ")
    .replace(/\[\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\((https:\/\/x\.com\/hashtag\/[^)]+)\)/g, "#$1")
    .replace(/\[([^\]]+)\]\((https:\/\/x\.com\/[^)]+)\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/Show more/g, " ")
    .replace(/Video \d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseProfileTweets(markdown, handle, limit) {
  const escapedHandle = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const itemRe = /\*\s+(?:Pinned\s+)?([\s\S]*?)(?=\n\*\s+|$)/g;
  const statusRe = new RegExp(`\\[([^\\]]+)\\]\\(https://(?:x|twitter|mobile\\.twitter)\\.com/${escapedHandle}/status/(\\d+)\\)`, "i");
  const tweets = [];
  let match;

  while ((match = itemRe.exec(markdown))) {
    const block = match[1];
    const statusMatch = block.match(statusRe);
    if (!statusMatch) continue;
    const id = statusMatch[2];
    const afterDate = block.slice(block.indexOf(statusMatch[0]) + statusMatch[0].length);
    const mediaMatch = afterDate.match(/!\[[^\]]*\]\((https:\/\/pbs\.twimg\.com\/(?:media|amplify_video_thumb)\/[^)]+)\)/);
    const text = cleanTweetMarkdown(afterDate);
    if (!text || text.length < 2) continue;
    tweets.push({
      id,
      handle,
      url: `https://x.com/${handle}/status/${id}`,
      createdAt: new Date(tweetTimestampFromSnowflake(id)).toISOString(),
      text: text.slice(0, 360),
      mediaUrl: mediaMatch?.[1] || null
    });
  }

  const unique = new Map();
  for (const tweet of tweets) if (!unique.has(tweet.id)) unique.set(tweet.id, tweet);
  return [...unique.values()]
    .filter(tweet => Number.isFinite(Date.parse(tweet.createdAt)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, limit);
}

async function loadTweetsForHandle(handle, limit = 3) {
  const safeHandle = String(handle || "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "");
  if (!safeHandle) return { handle, tweets: [], error: "missing handle" };

  const cacheKey = `${safeHandle}:${limit}`;
  const now = Date.now();
  const cached = tweetCache.get(cacheKey);
  if (cached && now - cached.at < 5 * 60_000) return cached.data;

  const markdown = await fetchText(X_READER_URL + encodeURIComponent(safeHandle));
  const data = {
    handle: safeHandle,
    fetchedAt: new Date().toISOString(),
    tweets: parseProfileTweets(markdown, safeHandle, limit)
  };
  tweetCache.set(cacheKey, { at: now, data });
  return data;
}

async function loadTweetsForHandles(handles, limit = 2) {
  const groups = await Promise.all(handles.slice(0, 5).map(async handle => {
    try {
      return await loadTweetsForHandle(handle, limit);
    } catch (error) {
      return { handle, tweets: [], error: error.message };
    }
  }));
  return {
    source: "X profile reader",
    fetchedAt: new Date().toISOString(),
    groups,
    tweets: groups
      .flatMap(group => group.tweets.map(tweet => ({ ...tweet, handle: group.handle })))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  };
}

module.exports = {
  loadPumpVolume,
  loadKolscanLeaderboard,
  loadTweetsForHandles
};
