/**
 * Netlify Function: mondaywebhook
 * Receives Monday.com webhook events and broadcasts
 * a refresh signal to all connected app clients via SSE.
 *
 * Monday webhook setup:
 * POST https://neon-salamander-3c77c2.netlify.app/.netlify/functions/mondaywebhook
 *
 * The app polls this endpoint every 30s as a fallback.
 * Real-time: Monday POSTs here on any board change → clients refresh.
 */

/* Simple in-memory last-update timestamp (resets on cold start) */
let lastUpdate = Date.now();

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  /* Monday sends a POST when something changes */
  if (event.httpMethod === "POST") {
    try {
      const body = JSON.parse(event.body || "{}");

      /* Monday challenge handshake (required to activate webhook) */
      if (body.challenge) {
        return {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ challenge: body.challenge }),
        };
      }

      /* Record the update timestamp */
      lastUpdate = Date.now();

      return {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, ts: lastUpdate }),
      };
    } catch(e) {
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify({ error: e.message }) };
    }
  }

  /* GET: app polls this to check for updates — returns last update timestamp */
  if (event.httpMethod === "GET") {
    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ts: lastUpdate }),
    };
  }

  return { statusCode: 405, headers: corsHeaders, body: "Method not allowed" };
};
