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

function normalizeUserName(name) {
  return String(name || "").trim().toLowerCase();
}

function uniqueNames(names = []) {
  const seen = new Set();
  return (names || []).map(name => String(name || "").trim()).filter(name => {
    const key = normalizeUserName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
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

async function storeNotificationEvents(recipientNames = [], alert = {}) {
  const recipients = uniqueNames(recipientNames);
  if (!recipients.length) return [];
  const createdAt = new Date().toISOString();
  return sbFetch("notification_events", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify(recipients.map(recipientName => ({
      recipient_name: recipientName,
      event_type: alert.eventType || "general",
      title: alert.title || "Podium 1 alert",
      body: alert.body || "",
      url: alert.url || "/",
      tag: alert.tag || "pt-alert",
      meta: alert.meta || {},
      created_at: createdAt,
    }))),
  });
}

async function getLatestAlert(userName) {
  const normalized = normalizeUserName(userName);
  if (!normalized) return null;
  const rows = await sbFetch(
    `notification_events?recipient_name=ilike.${encodeURIComponent(userName)}&order=created_at.desc&limit=1`,
    { method: "GET" }
  ).catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function notifyTargets(recipientNames = [], alert = {}, opts = {}) {
  const rows = await sbFetch("push_subscriptions?enabled=is.true&select=endpoint,user_name", {
    method: "GET",
  }).catch(() => []);
  const wanted = new Set(uniqueNames(recipientNames).map(normalizeUserName));
  const excludeSender = opts.excludeSender ? normalizeUserName(opts.excludeSender) : "";
  if (!wanted.size) return [];
  await storeNotificationEvents([...wanted], alert).catch(() => {});
  const targets = (rows || []).filter(row => {
    const rowName = normalizeUserName(row.user_name);
    if (!row.endpoint || !rowName || !wanted.has(rowName)) return false;
    if (excludeSender && rowName === excludeSender) return false;
    return true;
  });
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

async function notifyMessage(senderName, messageText = "") {
  const rows = await sbFetch("push_subscriptions?enabled=is.true&select=user_name", {
    method: "GET",
  }).catch(() => []);
  const recipients = uniqueNames((rows || []).map(row => row.user_name))
    .filter(name => normalizeUserName(name) !== normalizeUserName(senderName));
  const body = messageText ? String(messageText).trim().slice(0, 120) : "Open Podium 1 Production Tracker to read it.";
  return notifyTargets(recipients, {
    eventType: "team_message",
    title: senderName ? `${senderName} sent a message` : "New team message",
    body,
    url: "/#messages",
    tag: "team-message",
    meta: { senderName: senderName || "" },
  }, { excludeSender: senderName });
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const action = req.query?.action || req.body?.action || "";

    if (req.method === "GET" && action === "public-key") {
      return res.status(200).json({ publicKey: VAPID_PUBLIC_KEY || "" });
    }

    if (req.method === "GET" && action === "latest-alert") {
      const userName = req.query?.userName || "";
      const latest = await getLatestAlert(userName);
      return res.status(200).json({ latest });
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
      const messageText = req.body?.message || "";
      const results = await notifyMessage(senderName, messageText);
      return res.status(200).json({ ok: true, count: results.length });
    }

    if (req.method === "POST" && action === "notify-picklist-change") {
      const recipientNames = Array.isArray(req.body?.recipientNames) ? req.body.recipientNames : [];
      const results = await notifyTargets(recipientNames, {
        eventType: "picklist_change",
        title: req.body?.title || "Pick List Updated",
        body: req.body?.body || "A pick list has new items waiting for review.",
        url: req.body?.url || "/#queue",
        tag: req.body?.tag || "picklist-change",
        meta: req.body?.meta || {},
      });
      return res.status(200).json({ ok: true, count: results.length });
    }

    return res.status(400).json({ error: "Unsupported action" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Push route failed" });
  }
}
