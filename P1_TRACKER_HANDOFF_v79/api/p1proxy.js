/**
 * Vercel API Route: /api/p1proxy
 * Converted from Netlify Function.
 * Proxies P1 API calls AND Monday.com file uploads server-side,
 * bypassing browser CORS restrictions.
 *
 * Previously: /.netlify/functions/p1proxy
 * Now:        /api/p1proxy
 *
 * The frontend (index.html) calls this via fetch("/.netlify/functions/p1proxy", ...)
 * → In production on Vercel, update those fetch calls to /api/p1proxy
 *   OR add a rewrite in vercel.json (already done below in vercel.json).
 */

const P1_API_URL  = "https://submission-api-331638234113.us-central1.run.app";
const P1_API_KEY  = "p1r-0ed3fa51376c78f8ad9df9b43728e46d59f6ca7f447d8645";
const MONDAY_API_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjY3NDQwMzIwMCwiYWFpIjoxMSwidWlkIjo3MzA3NzY1NCwiaWFkIjoiMjAyNi0wNi0yM1QxNTozMjowOC4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MTcyNTAyMjIsInJnbiI6InVzZTEifQ.aQ2XoeK3ZCasOe6C4ocU5tow3bWga-myr-CAH6MUVtA";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export default async function handler(req, res) {
  /* Set CORS headers on every response */
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  /* Handle preflight */
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const query = req.query || {};

    /* ── Monday file upload ── */
    if (query.action === "monday-upload") {
      const payload  = req.body || {};
      const { query: gqlQuery, fileBase64, filename, mimeType } = payload;

      const boundary  = "----VercelBoundary" + Date.now();
      const fileBuffer = Buffer.from(fileBase64, "base64");

      let bodyStr = "";
      bodyStr += `--${boundary}\r\n`;
      bodyStr += `Content-Disposition: form-data; name="query"\r\n\r\n`;
      bodyStr += gqlQuery + "\r\n";
      bodyStr += `--${boundary}\r\n`;
      bodyStr += `Content-Disposition: form-data; name="variables[file]"; filename="${filename}"\r\n`;
      bodyStr += `Content-Type: ${mimeType}\r\n\r\n`;

      const bodyStart = Buffer.from(bodyStr, "utf8");
      const bodyEnd   = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
      const fullBody  = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

      const r = await fetch("https://api.monday.com/v2/file", {
        method: "POST",
        headers: {
          Authorization:   MONDAY_API_KEY,
          "API-Version":   "2024-01",
          "Content-Type":  `multipart/form-data; boundary=${boundary}`,
        },
        body: fullBody,
      });

      const data = await r.text();
      return res.status(r.status).json(JSON.parse(data));
    }

    /* ── P1 API proxy ── */
    let path, method, body;
    if (req.method === "GET") {
      path   = query.path || "/health";
      method = "GET";
      body   = undefined;
    } else {
      const payload = req.body || {};
      path   = payload.path;
      method = payload.method || "POST";
      body   = payload.body ? JSON.stringify(payload.body) : undefined;
    }

    if (!path) {
      return res.status(400).json({ error: "Missing path" });
    }

    const r    = await fetch(P1_API_URL + path, {
      method,
      headers: { "Content-Type": "application/json", "X-API-Key": P1_API_KEY },
      body,
    });
    const data = await r.text();

    res.status(r.status).setHeader("Content-Type", "application/json").end(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
