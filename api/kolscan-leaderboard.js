const { loadKolscanLeaderboard } = require("../lib/pyrora-data");

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const timeframe = Math.max(1, Math.min(30, Number(url.searchParams.get("timeframe") || 1)));
    const limit = Math.max(3, Math.min(20, Number(url.searchParams.get("limit") || 10)));
    const data = await loadKolscanLeaderboard(timeframe, limit);
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
  }
};
