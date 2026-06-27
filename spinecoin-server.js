const http = require("http");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || process.env.PYRORA_PORT || 4310);
const PUMP_URL = "https://frontend-api-v3.pump.fun/coins";
const DEX_URL = "https://api.dexscreener.com/tokens/v1/solana/";
const KOLSCAN_URL = "https://kolscan.io/leaderboard";
const X_READER_URL = "https://r.jina.ai/http://r.jina.ai/http://https://twitter.com/";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

let cache = null;
let cacheAt = 0;
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

function addTotals(target, source, windowKey) {
  const t = txns(source, windowKey);
  target.volume += volume(source, windowKey);
  target.buys += t.buys;
  target.sells += t.sells;
  target.trades += t.trades;
}

function emptyWindowMap() {
  return {
    m5: { volume: 0, buys: 0, sells: 0, trades: 0 },
    h1: { volume: 0, buys: 0, sells: 0, trades: 0 },
    h24: { volume: 0, buys: 0, sells: 0, trades: 0 }
  };
}

function windowStart(now, windowKey) {
  const spans = {
    m5: 5 * 60 * 1000,
    h1: 60 * 60 * 1000,
    h24: 24 * 60 * 60 * 1000
  };
  return now - spans[windowKey];
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
    pairCreatedAt: mintPairs
      .map(pair => pair.pairCreatedAt)
      .filter(Boolean)
      .sort((a, b) => a - b)[0],
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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 PYRORA local dashboard"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 PYRORA local dashboard"
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function decodeNextDataStream(html) {
  const chunks = [];
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)<\/script>/g;
  let match;
  while ((match = re.exec(html))) {
    chunks.push(JSON.parse(`"${match[1]}"`));
  }
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
  for (const tweet of tweets) {
    if (!unique.has(tweet.id)) unique.set(tweet.id, tweet);
  }

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

async function loadKolscanLeaderboard(timeframe = 1, limit = 10) {
  const now = Date.now();
  if (
    kolscanCache &&
    now - kolscanCacheAt < 60_000 &&
    kolscanCache.timeframe === timeframe &&
    kolscanCache.limit === limit
  ) {
    return kolscanCache.data;
  }

  const html = await fetchText(KOLSCAN_URL);
  const rsc = decodeNextDataStream(html);
  const rows = parseInitLeaderboard(rsc)
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

  const data = {
    source: "KOLScan public leaderboard page",
    fetchedAt: new Date().toISOString(),
    timeframe,
    rows
  };
  kolscanCache = { timeframe, limit, data };
  kolscanCacheAt = now;
  return data;
}

async function loadPumpVolume(limit) {
  const now = Date.now();
  if (cache && now - cacheAt < 10_000 && cache.limit === limit) return cache.data;

  const pumpUrl = new URL(PUMP_URL);
  pumpUrl.searchParams.set("offset", "0");
  pumpUrl.searchParams.set("limit", String(limit));
  pumpUrl.searchParams.set("sort", "last_trade_timestamp");
  pumpUrl.searchParams.set("order", "DESC");
  pumpUrl.searchParams.set("includeNsfw", "false");

  const coins = await fetchJson(pumpUrl);
  const mints = [...new Set(coins.map(coin => coin.mint).filter(Boolean))];
  const pairChunks = await Promise.all(
    chunk(mints, 30).map(group => fetchJson(DEX_URL + group.join(",")))
  );
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
      protocols: Object.fromEntries(
        windows.map(key => [key, [...aggregate.protocols[key].values()]])
      )
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
    graduations: Object.fromEntries(
      windows.map(key => [
        key,
        {
          count: graduations[key].count,
          tokens: graduations[key].tokens.sort((a, b) => b.graduatedAt - a.graduatedAt)
        }
      ])
    ),
    protocols: Object.fromEntries(
      windows.map(key => [
        key,
        [...protocols[key].values()].sort((a, b) => b.volume - a.volume)
      ])
    ),
    tokens
  };

  cache = { limit, data };
  cacheAt = now;
  return data;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/spinecoin.html";
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) throw new Error("bad path");
  const data = await fs.readFile(file);
  res.writeHead(200, {
    "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
    "cache-control": "no-store"
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/pump-volume") {
      const limit = Math.max(10, Math.min(90, Number(url.searchParams.get("limit") || 60)));
      const data = await loadPumpVolume(limit);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === "/api/kolscan-leaderboard") {
      const timeframe = Math.max(1, Math.min(30, Number(url.searchParams.get("timeframe") || 1)));
      const limit = Math.max(3, Math.min(20, Number(url.searchParams.get("limit") || 10)));
      const data = await loadKolscanLeaderboard(timeframe, limit);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === "/api/x-tweets") {
      const handles = String(url.searchParams.get("handles") || "")
        .split(",")
        .map(handle => handle.trim())
        .filter(Boolean)
        .slice(0, 5);
      const limit = Math.max(1, Math.min(4, Number(url.searchParams.get("limit") || 2)));
      const groups = await Promise.all(
        handles.map(async handle => {
          try {
            return await loadTweetsForHandle(handle, limit);
          } catch (error) {
            return { handle, tweets: [], error: error.message };
          }
        })
      );
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({
        source: "X profile reader",
        fetchedAt: new Date().toISOString(),
        groups,
        tweets: groups
          .flatMap(group => group.tweets.map(tweet => ({ ...tweet, handle: group.handle })))
          .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      }));
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter(info => info && info.family === "IPv4" && !info.internal)
    .map(info => `http://${info.address}:${PORT}/spinecoin.html`);
  console.log(`PYRORA pump volume dashboard: http://127.0.0.1:${PORT}/spinecoin.html`);
  if (addresses.length) console.log(`Phone/LAN URLs:\\n${addresses.join("\\n")}`);
});
