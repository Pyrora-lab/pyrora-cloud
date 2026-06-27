const { loadTweetsForHandles } = require("../lib/pyrora-data");

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const handles = String(url.searchParams.get("handles") || "")
      .split(",")
      .map(handle => handle.trim())
      .filter(Boolean)
      .slice(0, 5);
    const limit = Math.max(1, Math.min(4, Number(url.searchParams.get("limit") || 2)));
    const data = await loadTweetsForHandles(handles, limit);
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: error.message }));
  }
};
