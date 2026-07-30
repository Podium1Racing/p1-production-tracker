const SUPABASE_URL = process.env.SUPABASE_URL || "https://paufeygvqwyidyasuubr.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KIT_ROLE = "kit";
const CONFIG_ROLE = "config";
const FLOAT_ROLE = "float";

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanName(value) {
  return String(value || "").trim();
}

function uniqueNames(values = []) {
  const seen = new Set();
  return (values || [])
    .map(cleanName)
    .filter(value => {
      const key = normalizeName(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function sbFetch(path, options = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: options.prefer || "return=representation",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function getTeamMemberByName(name) {
  const clean = cleanName(name);
  if (!clean) return null;
  const rows = await sbFetch(
    `team_members?name=eq.${encodeURIComponent(clean)}&select=name,role,active&limit=1`,
    { method: "GET" }
  ).catch(() => []);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function ensureAuthorizedActor({ userName, claimedRole, leadNames, adminName, kitterNames, configurationNames }) {
  const normalizedUser = normalizeName(userName);
  if (!normalizedUser) {
    throw new Error("Missing user name.");
  }

  const normalizedAdmin = normalizeName(adminName);
  if (normalizedAdmin && normalizedUser === normalizedAdmin) {
    return { ok: true, mode: "admin", actorName: cleanName(userName) };
  }

  const allowedLeadNames = new Set(uniqueNames(leadNames).map(normalizeName));
  if (allowedLeadNames.has(normalizedUser)) {
    return { ok: true, mode: "lead", actorName: cleanName(userName) };
  }

  const normalizedClaimedRole = String(claimedRole || "").trim().toLowerCase();
  const allowedKitterNames = new Set(uniqueNames(kitterNames).map(normalizeName));
  if (allowedKitterNames.has(normalizedUser) && normalizedClaimedRole === KIT_ROLE) {
    return { ok: true, mode: KIT_ROLE, actorName: cleanName(userName) };
  }

  const allowedConfigurationNames = new Set(uniqueNames(configurationNames).map(normalizeName));
  if (allowedConfigurationNames.has(normalizedUser) && normalizedClaimedRole === CONFIG_ROLE) {
    return { ok: true, mode: CONFIG_ROLE, actorName: cleanName(userName) };
  }

  const member = await getTeamMemberByName(userName);
  if (!member?.name) {
    throw new Error("User is not allowed to change pick list allocation.");
  }

  const role = String(member.role || "").trim().toLowerCase();
  const active = member.active !== false;
  if (!active) throw new Error("Inactive users cannot change pick list allocation.");

  if (role === KIT_ROLE || role === CONFIG_ROLE) {
    return { ok: true, mode: role, actorName: member.name };
  }

  if (role === FLOAT_ROLE && [KIT_ROLE, CONFIG_ROLE].includes(normalizedClaimedRole)) {
    return { ok: true, mode: "float_override", actorName: member.name };
  }

  throw new Error("User is not allowed to change pick list allocation.");
}

function parseItemIds(changes = []) {
  return (Array.isArray(changes) ? changes : [])
    .map(change => ({
      itemId: Number(change?.itemId),
      allocated: !!change?.allocated,
    }))
    .filter(change => Number.isFinite(change.itemId) && change.itemId > 0);
}

async function loadPickListItems(ids = []) {
  if (!ids.length) return [];
  const rows = await sbFetch(
    `picklist_items?id=in.(${ids.join(",")})&select=id,picklist_id,label,allocated`,
    { method: "GET" }
  );
  return Array.isArray(rows) ? rows : [];
}

async function loadPickListsByIds(ids = []) {
  const cleanIds = uniqueNames(ids);
  if (!cleanIds.length) return [];
  const chunks = await Promise.all(cleanIds.map(id => (
    sbFetch(`picklists?id=eq.${encodeURIComponent(id)}&select=id,wo_number,customer_name,status&limit=1`, {
      method: "GET"
    }).catch(() => [])
  )));
  return chunks.flat().filter(Boolean);
}

async function patchItemAllocation(itemId, allocated) {
  const rows = await sbFetch(`picklist_items?id=eq.${itemId}`, {
    method: "PATCH",
    prefer: "return=representation",
    body: JSON.stringify({ allocated: !!allocated }),
  });
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

async function insertAuditRows(rows = []) {
  if (!rows.length) return;
  await sbFetch("picklist_allocation_audit", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify(rows),
  });
}

async function saveAllocationChanges(payload = {}) {
  const actor = await ensureAuthorizedActor(payload);
  const requestedChanges = parseItemIds(payload.changes);
  if (!requestedChanges.length) throw new Error("No allocation changes supplied.");

  const currentItems = await loadPickListItems(requestedChanges.map(change => change.itemId));
  const itemMap = new Map(currentItems.map(item => [Number(item.id), item]));
  if (itemMap.size !== requestedChanges.length) {
    throw new Error("Some pick list items could not be found.");
  }

  const picklists = await loadPickListsByIds(currentItems.map(item => item.picklist_id));
  const picklistMap = new Map(picklists.map(row => [String(row.id), row]));
  const changedAt = new Date().toISOString();
  const auditRows = [];
  const savedRows = [];

  for (const change of requestedChanges) {
    const existing = itemMap.get(change.itemId);
    if (!existing) continue;
    const previousAllocated = !!existing.allocated;
    const nextAllocated = !!change.allocated;
    const updated = await patchItemAllocation(change.itemId, nextAllocated);
    if (updated) savedRows.push(updated);

    const pl = picklistMap.get(String(existing.picklist_id)) || {};
    auditRows.push({
      picklist_item_id: Number(existing.id),
      picklist_id: existing.picklist_id != null ? String(existing.picklist_id) : null,
      wo_number: pl.wo_number || null,
      customer_name: pl.customer_name || null,
      item_label: existing.label || null,
      previous_allocated: previousAllocated,
      new_allocated: nextAllocated,
      user_name: actor.actorName,
      claimed_role: cleanName(payload.claimedRole) || null,
      reason: cleanName(payload.reason) || null,
      note: cleanName(payload.note) || null,
      changed_at: changedAt,
    });
  }

  await insertAuditRows(auditRows);
  return savedRows;
}

export default async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const action = req.query?.action || req.body?.action || "";
    if (action !== "save") return res.status(400).json({ error: "Unsupported action." });

    const rows = await saveAllocationChanges(req.body || {});
    return res.status(200).json({ ok: true, rows });
  } catch (err) {
    return res.status(400).json({ error: String(err.message || err) });
  }
}
