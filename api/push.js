const SUPABASE_URL = process.env.SUPABASE_URL || "https://paufeygvqwyidyasuubr.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:notifications@podium1racing.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const te = new TextEncoder();

function base64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const clean = String(pem || "")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(clean, "base64");
}

async function createVapidJwt(audience) {
  const header = { typ: "JWT", alg: "ES256" };
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(VAPID_PRIVATE_KEY),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    te.encode(unsigned)
  );
  return `${unsigned}.${base64url(sig)}`;
}

async function sbFetch(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!r.ok) throw new Error(await r.text());
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function saveSubscription(subscription, userName) {
  const payload = {
    endpoint: subscription.endpoint,
    p256dh: subscription.keys?.p256dh || "",
    auth: subscription.keys?.auth || "",
    user_name: userName || null,
    enabled: true,
    updated_at: new Date().toISOString(),
  };
  const existing = await sbFetch(`push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}&select=endpoint`, {
    method: "GET",
  }).catch(() => []);
  if (Array.isArray(existing) && existing.length) {
    return sbFetch(`push_subscriptions?endpoint=eq.${encodeURIComponent(subscription.endpoint)}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: JSON.stringify(payload),
    });
  }
  payload.created_at = payload.updated_at;
  return sbFetch("push_subscriptions", {
    method: "POST",
    prefer: "return=representation",
    body: JSON.stringify(payload),
  });
}

async function removeSubscription(endpoint) {
  return sbFetch(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

async function sendPush(endpoint) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) throw new Error("Missing VAPID keys");
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const jwt = await createVapidJwt(audience);
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: "60",
      Urgency: "normal",
      Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      "Crypto-Key": `p256ecdsa=${VAPID_PUBLIC_KEY}`,
    },
  });
  if (!r.ok && r.status !== 201) {
    const body = await r.text();
    throw new Error(`${r.status} ${body}`);
  }
}

async function notifyMessage(senderName) {
  const rows = await sbFetch("push_subscriptions?enabled=is.true&select=endpoint,user_name", {
    method: "GET",
  }).catch(() => []);
  const targets = (rows || []).filter(row => row.endpoint && row.user_name !== senderName);
  const results = await Promise.allSettled(targets.map(async row => {
    try {
      await sendPush(row.endpoint);
      return { endpoint: row.endpoint, ok: true };
    } catch (err) {
      const msg = String(err.message || "");
      if (msg.includes("404") || msg.includes("410")) {
        await removeSubscription(row.endpoint).catch(() => {});
      }
      return { endpoint: row.endpoint, ok: false, error: msg };
    }
  }));
  return results;
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const action = req.query?.action || req.body?.action || "";

    if (req.method === "GET" && action === "public-key") {
      return res.status(200).json({ publicKey: VAPID_PUBLIC_KEY || "" });
    }

    if (req.method === "GET" && action === "latest-message") {
      const rows = await sbFetch("team_messages?order=created_at.desc&limit=1", { method: "GET" }).catch(() => []);
      return res.status(200).json({ latest: Array.isArray(rows) ? rows[0] || null : null });
    }

    if (req.method === "POST" && action === "subscribe") {
      const { subscription, userName } = req.body || {};
      if (!subscription?.endpoint) return res.status(400).json({ error: "Missing subscription" });
      const saved = await saveSubscription(subscription, userName);
      return res.status(200).json({ ok: true, saved });
    }

    if (req.method === "POST" && action === "unsubscribe") {
      const { endpoint } = req.body || {};
      if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });
      await removeSubscription(endpoint).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    if (req.method === "POST" && action === "notify-message") {
      const senderName = req.body?.senderName || "";
      const results = await notifyMessage(senderName);
      return res.status(200).json({ ok: true, count: results.length });
    }

    return res.status(400).json({ error: "Unsupported action" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Push route failed" });
  }
}
