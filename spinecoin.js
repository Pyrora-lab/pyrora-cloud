const updatedTime = document.querySelector("#updatedTime");
const state = {
  activeWindow: "h24",
  data: null,
  leaderboard: [],
  lastLoadedAt: 0
};

const labelMap = { m5: "5M", h1: "1H", h24: "24H" };

const els = {
  sourceState: document.querySelector("#sourceState"),
  sourceDetail: document.querySelector("#sourceDetail"),
  sparkline: document.querySelector("#sparkline"),
  windowLabel: document.querySelector("#windowLabel"),
  totalVolume: document.querySelector("#totalVolume"),
  totalTrades: document.querySelector("#totalTrades"),
  transactionTotal: document.querySelector("#transactionTotal"),
  refreshAge: document.querySelector("#refreshAge"),
  buySplitLine: document.querySelector("#buySplitLine"),
  buySplit: document.querySelector("#buySplit"),
  sellSplit: document.querySelector("#sellSplit"),
  tokensSampled: document.querySelector("#tokensSampled"),
  graduatedCount: document.querySelector("#graduatedCount"),
  completeCount: document.querySelector("#completeCount"),
  topTokens: document.querySelector("#topTokens"),
  protocolRows: document.querySelector("#protocolRows"),
  graduationTitle: document.querySelector("#graduationTitle"),
  graduationWindowCount: document.querySelector("#graduationWindowCount"),
  graduationWindowLabel: document.querySelector("#graduationWindowLabel"),
  graduatedTokenList: document.querySelector("#graduatedTokenList"),
  leaderboardRows: document.querySelector("#leaderboardRows"),
  tweetModal: document.querySelector("#tweetModal"),
  tweetModalTitle: document.querySelector("#tweetModalTitle"),
  tweetModalMeta: document.querySelector("#tweetModalMeta"),
  tweetModalBody: document.querySelector("#tweetModalBody"),
  tweetModalActions: document.querySelector("#tweetModalActions"),
  tweetModalClose: document.querySelector("#tweetModalClose"),
  tweetDock: document.querySelector("#tweetDock"),
  openTopTweets: document.querySelector("#openTopTweets"),
  tokenTable: document.querySelector("#tokenTable"),
  tableVolumeHead: document.querySelector("#tableVolumeHead"),
  sourceNote: document.querySelector("#sourceNote")
};

function tickClock() {
  updatedTime.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function compact(value, digits = 2) {
  if (!Number.isFinite(value)) return "--";
  return Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: digits
  }).format(value);
}

function money(value) {
  if (!Number.isFinite(value)) return "--";
  return `$${compact(value, value >= 1_000_000 ? 2 : 1)}`;
}

function sol(value) {
  if (!Number.isFinite(value)) return "-- SOL";
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(2)} SOL`;
}

function txns(row, win) {
  const source = row?.txns?.[win] || {};
  const buys = source.buys || 0;
  const sells = source.sells || 0;
  return { buys, sells, total: buys + sells };
}

function winVolume(row, win) {
  return row?.volume?.[win] || 0;
}

function setWindow(win) {
  state.activeWindow = win;
  document.querySelectorAll("[data-window]").forEach(button => {
    button.classList.toggle("active", button.dataset.window === win);
  });
  render();
}

function setSparkline(tokens, win) {
  const values = tokens.slice(0, 18).map(token => winVolume(token, win));
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 2 : 2 + (index / (values.length - 1)) * 116;
    const y = 42 - (value / max) * 34;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  els.sparkline.setAttribute("points", points.join(" "));
}

function renderPills(container, rows, win, kind) {
  container.innerHTML = "";
  rows.slice(0, 3).forEach(row => {
    const displayVolume = kind === "token" ? winVolume(row, win) : row.volume;
    const div = document.createElement("div");
    div.innerHTML = `
      <span>${(row.label || row.symbol || row.protocol || "token").slice(0, 12)}</span>
      <strong>${money(displayVolume)}</strong>
      <em>${kind === "token" ? `${compact(txns(row, win).total, 1)} txns` : `${compact(row.count, 1)} pairs`}</em>
    `;
    container.appendChild(div);
  });
}

function renderTable(tokens, win) {
  if (!els.tokenTable) return;
  const rows = tokens.slice(0, 5);
  els.tokenTable.innerHTML = "";
  rows.forEach(token => {
    const tr = document.createElement("tr");
    const count = txns(token, win).total;
    tr.innerHTML = `
      <td><a href="${token.url}" target="_blank" rel="noreferrer">${token.symbol || "UNKNOWN"}</a></td>
      <td>${money(winVolume(token, win))}</td>
      <td>${compact(count, 1)}</td>
    `;
    els.tokenTable.appendChild(tr);
  });
}

function renderGraduations(data, win) {
  const label = labelMap[win];
  const graduationData = data.graduations?.[win] || { count: 0, tokens: [] };
  els.graduationTitle.textContent = `${label} Graduations`;
  els.graduationWindowCount.textContent = compact(graduationData.count, 0);
  els.graduationWindowLabel.textContent = `${label} window`;
  els.graduatedTokenList.innerHTML = "";

  if (!graduationData.tokens.length) {
    const empty = document.createElement("p");
    empty.textContent = `No sampled pump.fun tokens graduated in the ${label} window.`;
    els.graduatedTokenList.appendChild(empty);
    return;
  }

  graduationData.tokens.slice(0, 3).forEach(token => {
    const row = document.createElement("a");
    row.href = token.url;
    row.target = "_blank";
    row.rel = "noreferrer";
    row.className = "graduated-row";
    row.innerHTML = `
      <span>${token.symbol || "UNKNOWN"}</span>
      <strong>${money(token.volume || 0)}</strong>
      <em>${compact(token.trades || 0, 1)} txns</em>
    `;
    els.graduatedTokenList.appendChild(row);
  });
}

function twitterProfileUrl(row) {
  if (!row.twitterUrl) return null;
  if (!row.twitterHandle) return row.twitterUrl;
  return `https://x.com/${row.twitterHandle}`;
}

function twitterLatestUrl(row) {
  if (!row.twitterHandle) return null;
  return `https://x.com/search?q=${encodeURIComponent(`from:${row.twitterHandle}`)}&f=live`;
}

function loadTwitterWidget() {
  if (window.twttr?.widgets?.load) {
    window.twttr.widgets.load(els.tweetModalBody);
    return;
  }
  if (document.querySelector("#twitter-wjs")) return;
  const script = document.createElement("script");
  script.id = "twitter-wjs";
  script.src = "https://platform.twitter.com/widgets.js";
  script.async = true;
  script.onload = () => window.twttr?.widgets?.load?.(els.tweetModalBody);
  document.body.appendChild(script);
}

function closeTweetModal() {
  els.tweetModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
  els.tweetModalBody.innerHTML = "";
}

function openTopKolTweets() {
  const top = state.leaderboard[0];
  if (top) openTweetModal(top);
}

function addTweetAction(label, href) {
  if (!href) return;
  const link = document.createElement("a");
  link.href = href;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = label;
  els.tweetModalActions.appendChild(link);
}

function renderTopKolTweetLinks(activeRow) {
  const panel = document.createElement("div");
  panel.className = "tweet-kol-list";

  const title = document.createElement("strong");
  title.textContent = "Top KOL recent posts";
  panel.appendChild(title);

  state.leaderboard.slice(0, 5).forEach(row => {
    const item = document.createElement("a");
    item.className = "tweet-kol-row";
    item.href = twitterLatestUrl(row) || twitterProfileUrl(row) || row.profileUrl;
    item.target = "_blank";
    item.rel = "noreferrer";
    item.classList.toggle("active", row.wallet === activeRow?.wallet);
    item.innerHTML = `
      <span>${row.rank}. ${row.name}</span>
      <em>${row.twitterHandle ? `@${row.twitterHandle}` : row.walletShort}</em>
      <b>Latest</b>
    `;
    panel.appendChild(item);
  });

  return panel;
}

function formatTweetTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderTweetCards(container, tweets) {
  container.innerHTML = "";
  if (!tweets.length) {
    const empty = document.createElement("p");
    empty.className = "tweet-fallback";
    empty.textContent = "No readable tweets came through from X for these KOLs yet.";
    container.appendChild(empty);
    return;
  }

  tweets.slice(0, 6).forEach(tweet => {
    const card = document.createElement("a");
    card.className = "tweet-card";
    card.href = tweet.url;
    card.target = "_blank";
    card.rel = "noreferrer";

    const meta = document.createElement("span");
    meta.className = "tweet-card-meta";
    meta.textContent = `@${tweet.handle} · ${formatTweetTime(tweet.createdAt)}`;

    const text = document.createElement("p");
    text.textContent = tweet.text;

    card.append(meta, text);
    if (tweet.mediaUrl) {
      const img = document.createElement("img");
      img.src = tweet.mediaUrl;
      img.alt = "";
      img.loading = "lazy";
      card.appendChild(img);
    }
    container.appendChild(card);
  });
}

async function loadTweetCards(activeRow, container) {
  const rows = [activeRow, ...state.leaderboard.filter(row => row.wallet !== activeRow.wallet)]
    .filter(row => row.twitterHandle)
    .slice(0, 4);
  const handles = rows.map(row => row.twitterHandle).join(",");
  if (!handles) {
    renderTweetCards(container, []);
    return;
  }

  try {
    const response = await fetch(`/api/x-tweets?handles=${encodeURIComponent(handles)}&limit=2&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    renderTweetCards(container, data.tweets || []);
  } catch (error) {
    container.innerHTML = "";
    const message = document.createElement("p");
    message.className = "tweet-fallback";
    message.textContent = `Tweets could not load: ${error.message}`;
    container.appendChild(message);
  }
}

function openTweetModal(row) {
  const profileUrl = twitterProfileUrl(row);
  els.tweetModal.classList.remove("hidden");
  document.body.classList.add("modal-open");
  els.tweetModalTitle.textContent = "Top KOL tweets";
  els.tweetModalMeta.textContent = row.twitterHandle
    ? `Showing readable recent tweets for ${row.name} and nearby top KOLs.`
    : "KOLScan did not expose an X handle for this trader.";
  els.tweetModalBody.innerHTML = "";
  els.tweetModalActions.innerHTML = "";
  els.tweetModalBody.appendChild(renderTopKolTweetLinks(row));

  const cards = document.createElement("div");
  cards.className = "tweet-cards";
  cards.innerHTML = `<p class="tweet-fallback">Loading actual tweet cards...</p>`;
  els.tweetModalBody.appendChild(cards);
  loadTweetCards(row, cards);

  addTweetAction("Latest posts", twitterLatestUrl(row) || profileUrl || `https://x.com/search?q=${encodeURIComponent(row.name)}&f=live`);
  addTweetAction("Open X", profileUrl || `https://x.com/search?q=${encodeURIComponent(row.name)}&f=live`);
  addTweetAction("Open KOLScan", row.profileUrl);
  addTweetAction("Telegram", row.telegramUrl);
}

function renderLeaderboard(rows) {
  els.leaderboardRows.innerHTML = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.textContent = "KOLScan leaderboard is not loaded yet.";
    els.leaderboardRows.appendChild(empty);
    return;
  }

  if (els.tweetDock) {
    els.tweetDock.classList.remove("hidden");
    els.tweetDock.querySelector("strong").textContent = rows[0].twitterHandle
      ? `@${rows[0].twitterHandle}`
      : rows[0].name;
  }

  rows.forEach(row => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "leaderboard-row";
    card.addEventListener("click", () => openTweetModal(row));

    const avatar = document.createElement("img");
    avatar.src = row.avatarUrl || "";
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.onerror = () => avatar.remove();

    const identity = document.createElement("span");
    identity.className = "leaderboard-identity";
    const name = document.createElement("strong");
    name.textContent = `${row.rank}. ${row.name}`;
    const handle = document.createElement("em");
    handle.textContent = row.twitterHandle ? `@${row.twitterHandle}` : row.walletShort;
    identity.append(name, handle);

    const stats = document.createElement("span");
    stats.className = "leaderboard-stats";
    const profit = document.createElement("strong");
    profit.textContent = sol(row.profitSol);
    const record = document.createElement("em");
    record.textContent = `${row.wins}W / ${row.losses}L`;
    stats.append(profit, record);

    card.append(avatar, identity, stats);
    els.leaderboardRows.appendChild(card);
  });
}

function render() {
  const data = state.data;
  const win = state.activeWindow;
  const label = labelMap[win];

  if (!data) return;

  const tokens = [...data.tokens].sort((a, b) => winVolume(b, win) - winVolume(a, win));
  const totals = data.totals[win] || { volume: 0, buys: 0, sells: 0, trades: 0 };
  const buyPct = (totals.buys / Math.max(totals.trades, 1)) * 100;
  const age = state.lastLoadedAt ? Math.max(0, Math.round((Date.now() - state.lastLoadedAt) / 1000)) : 0;

  els.windowLabel.textContent = label;
  document.querySelector("#volumeTitle").textContent = `${label} buy/sell activity`;
  els.totalVolume.textContent = money(totals.volume);
  els.totalTrades.textContent = compact(totals.trades, 1);
  els.transactionTotal.textContent = `${compact(totals.trades, 1)} txns`;
  els.refreshAge.textContent = `${age}s ago`;
  els.buySplitLine.style.setProperty("--w", `${Math.max(0, Math.min(100, buyPct))}%`);
  els.buySplit.textContent = `Buys ${compact(totals.buys, 1)}`;
  els.sellSplit.textContent = `Sells ${compact(totals.sells, 1)}`;
  els.tokensSampled.textContent = compact(data.tokensSampled, 0);
  els.graduatedCount.textContent = compact(data.graduations?.[win]?.count || 0, 0);
  els.completeCount.textContent = compact(data.graduated, 0);
  if (els.tableVolumeHead) els.tableVolumeHead.textContent = `${label} Vol`;
  els.sourceState.textContent = "Live";
  els.sourceDetail.textContent = `${data.tokensSampled} Pump tokens`;
  if (els.sourceNote) {
    els.sourceNote.textContent = `pump.fun + DEX Screener ${label} volume refreshes every 15 seconds. KOLScan refreshes every minute.`;
  }

  setSparkline(tokens, win);
  renderPills(els.topTokens, tokens, win, "token");
  renderPills(els.protocolRows, data.protocols[win] || [], win, "protocol");
  renderGraduations(data, win);
  renderTable(tokens, win);
}

async function loadKolscanLeaderboard() {
  try {
    const response = await fetch(`/api/kolscan-leaderboard?timeframe=1&limit=5&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    state.leaderboard = data.rows || [];
    renderLeaderboard(state.leaderboard);
  } catch (error) {
    els.leaderboardRows.innerHTML = "";
    const message = document.createElement("p");
    message.textContent = `KOLScan leaderboard could not load: ${error.message}`;
    els.leaderboardRows.appendChild(message);
  }
}

async function loadPumpVolume() {
  try {
    const response = await fetch(`/api/pump-volume?limit=60&t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    state.lastLoadedAt = Date.now();
    render();
  } catch (error) {
    els.sourceState.textContent = "Server needed";
    els.sourceDetail.textContent = "Open localhost";
    if (els.sourceNote) {
      els.sourceNote.textContent = `Live pump.fun data requires the local PYRORA server because pump.fun blocks browser CORS. ${error.message}`;
    }
  }
}

document.querySelectorAll("[data-window]").forEach(button => {
  button.addEventListener("click", () => setWindow(button.dataset.window));
});

els.tweetModalClose.addEventListener("click", closeTweetModal);
els.tweetModal.addEventListener("click", event => {
  if (event.target.matches("[data-close-modal]")) closeTweetModal();
});
els.tweetDock?.addEventListener("click", openTopKolTweets);
els.openTopTweets?.addEventListener("click", openTopKolTweets);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !els.tweetModal.classList.contains("hidden")) closeTweetModal();
});

tickClock();
setInterval(tickClock, 1000);
loadPumpVolume();
loadKolscanLeaderboard();
setInterval(loadPumpVolume, 15000);
setInterval(loadKolscanLeaderboard, 60000);
setInterval(render, 1000);

if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")
) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}
