const { loadPumpVolume } = require("../lib/pyrora-data");

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const limit = Math.max(10, Math.min(90, Number(url.searchParams.get("limit") || 60)));
    const data = await loadPumpVolume(limit);
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
  }
};
