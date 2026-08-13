import crypto from "crypto";

export const SESSION_COOKIE_NAME = "__Host-pt_session";
export const SESSION_MAX_AGE_SECONDS = Number(process.env.PT_SESSION_MAX_AGE_SECONDS || 12 * 60 * 60);
export const SESSION_VERSION = "2";

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SESSION_SECRET = process.env.PT_SESSION_SECRET || "";
const GATE_USERNAME = process.env.PT_GATE_USERNAME || "";
const GATE_PASSWORD_HASH = process.env.PT_GATE_PASSWORD_HASH || "";
const ALLOWED_ORIGIN = process.env.PT_ALLOWED_ORIGIN || "";
const ADMIN_NAME = process.env.PT_ADMIN_NAME || "Elijah Moosekian";
const MS_LEAD_NAME = process.env.PT_MS_LEAD_NAME || "Thomas Persichina";
const CHASSIS_LEAD_NAME = process.env.PT_CHASSIS_LEAD_NAME || "Sepan Ali";
const AUTH_LEVEL_AUTHENTICATED = "authenticated";
const AUTH_LEVEL_ROLE_REQUIRED = "role_required";
const ROLE_MS = "ms";
const ROLE_CHASSIS = "chassis";
const ROLE_KIT = "kit";
const ROLE_CONFIG = "config";
const ROLE_FLOAT = "float";
const ROLE_ADMIN = "admin";
const CANONICAL_ROLES = new Set([ROLE_MS, ROLE_CHASSIS, ROLE_KIT, ROLE_CONFIG, ROLE_FLOAT, ROLE_ADMIN]);
const FLOATER_ALLOWED_ROLES = Object.freeze([ROLE_MS, ROLE_CHASSIS, ROLE_KIT]);

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function fromBase64url(input) {
  return Buffer.from(String(input || ""), "base64url");
}

function constantTimeEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a || ""));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b || ""));
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function normalizeName(value) {
  return String(value || "").trim();
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeAllowedRoles(roles = []) {
  return Array.from(new Set((Array.isArray(roles) ? roles : [])
    .map(normalizeRole)
    .filter(role => FLOATER_ALLOWED_ROLES.includes(role))));
}

function normalizeTrustedUser(user = {}, { activeRole = undefined } = {}) {
  const id = normalizeName(user.id || user.name);
  const name = normalizeName(user.name);
  if (!id || !name) return null;
  const baseRole = normalizeRole(user.baseRole || user.role);
  if (!CANONICAL_ROLES.has(baseRole)) return null;
  const isFloater = baseRole === ROLE_FLOAT;
  const allowedRoles = isFloater ? normalizeAllowedRoles(user.allowedRoles?.length ? user.allowedRoles : FLOATER_ALLOWED_ROLES) : [baseRole];
  const requestedActiveRole = activeRole === undefined ? user.activeRole : activeRole;
  const normalizedActiveRole = requestedActiveRole === null || requestedActiveRole === undefined || requestedActiveRole === ""
    ? null
    : normalizeRole(requestedActiveRole);
  if (isFloater && normalizedActiveRole !== null && !allowedRoles.includes(normalizedActiveRole)) return null;
  if (!isFloater && normalizedActiveRole !== baseRole) return null;
  const role = isFloater ? (normalizedActiveRole || ROLE_FLOAT) : baseRole;
  if (!CANONICAL_ROLES.has(role)) return null;
  return {
    id,
    name,
    role,
    baseRole,
    activeRole: isFloater ? normalizedActiveRole : baseRole,
    allowedRoles,
    isFloater,
    isLead: !!user.isLead,
    isAdmin: !!user.isAdmin,
  };
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function getRequestOrigin(req) {
  return req.headers?.origin || "";
}

function getExpectedOrigin(req) {
  if (ALLOWED_ORIGIN) return ALLOWED_ORIGIN;
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const host = req.headers?.["x-forwarded-host"] || req.headers?.host || "";
  return host ? `${proto}://${host}` : "";
}

export function setNoStore(res) {
  res.setHeader("Cache-Control", "no-store");
}

export function sendJson(res, status, data) {
  setNoStore(res);
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(data);
}

export function requireMethod(req, res, method) {
  if (req.method === method) return true;
  res.setHeader("Allow", method);
  sendJson(res, 405, { error: "Method not allowed." });
  return false;
}

export function validateOrigin(req, res) {
  const origin = getRequestOrigin(req);
  const expected = getExpectedOrigin(req);
  if (origin && expected && origin !== expected) {
    sendJson(res, 403, { error: "Forbidden." });
    return false;
  }
  return true;
}

export function requireJson(req, res) {
  const contentType = req.headers?.["content-type"] || "";
  if (contentType.toLowerCase().startsWith("application/json")) return true;
  sendJson(res, 415, { error: "Expected application/json." });
  return false;
}

export function getJsonBody(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

function getSessionSecret() {
  if (SESSION_SECRET.length < 32) throw new Error("Session secret is not configured.");
  return SESSION_SECRET;
}

function signPayload(payload) {
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest();
  return `${encodedPayload}.${base64url(signature)}`;
}

export function createSessionToken({ authLevel = "gate_passed", user = null } = {}) {
  const issuedAt = nowSeconds();
  const payload = {
    sessionVersion: SESSION_VERSION,
    sessionId: crypto.randomUUID(),
    authLevel,
    issuedAt,
    expiresAt: issuedAt + SESSION_MAX_AGE_SECONDS,
  };
  if (user) {
    const trusted = normalizeTrustedUser(user);
    if (!trusted) throw new Error("Invalid trusted session user.");
    payload.userId = trusted.id || trusted.name;
    payload.name = trusted.name;
    payload.role = trusted.role;
    payload.baseRole = trusted.baseRole;
    payload.activeRole = trusted.activeRole;
    payload.allowedRoles = trusted.allowedRoles;
    payload.isFloater = trusted.isFloater;
    payload.isLead = trusted.isLead;
    payload.isAdmin = trusted.isAdmin;
  }
  return signPayload(payload);
}

export function verifySessionToken(token) {
  if (!token || !String(token).includes(".")) return null;
  const parts = String(token).split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return null;
  const expected = crypto
    .createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest();
  if (!constantTimeEqual(expected, fromBase64url(encodedSignature))) return null;
  let payload;
  try {
    payload = JSON.parse(fromBase64url(encodedPayload).toString("utf8"));
  } catch {
    return null;
  }
  if (payload.sessionVersion !== SESSION_VERSION) return null;
  if (!payload.expiresAt || payload.expiresAt <= nowSeconds()) return null;
  return payload;
}

export function parseCookies(req) {
  const header = req.headers?.cookie || "";
  return Object.fromEntries(header.split(";").map(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return ["", ""];
    return [part.slice(0, idx).trim(), part.slice(idx + 1).trim()];
  }).filter(([key]) => key));
}

export function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  try {
    return verifySessionToken(token);
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE_NAME}=${token}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; Secure; SameSite=Lax`,
  ]);
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", [
    `${SESSION_COOKIE_NAME}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax`,
  ]);
}

export function sessionUser(payload) {
  if (!payload?.name) return null;
  const user = normalizeTrustedUser({
    id: payload.userId || payload.name,
    name: payload.name,
    role: payload.baseRole || payload.role,
    baseRole: payload.baseRole,
    activeRole: payload.activeRole,
    allowedRoles: payload.allowedRoles,
    isLead: payload.isLead,
    isAdmin: payload.isAdmin,
  });
  if (!user) return null;
  return {
    ...user,
  };
}

export function sessionResponse(payload) {
  const user = sessionUser(payload);
  return {
    authenticated: payload?.authLevel === AUTH_LEVEL_AUTHENTICATED && !!user,
    gatePassed: !!payload,
    authLevel: payload?.authLevel || "none",
    user,
  };
}

async function sbFetch(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service credentials are not configured.");
  }
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
  if (!response.ok) throw new Error("Supabase request failed.");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function getTrustedUserByName(name) {
  const clean = normalizeName(name);
  if (!clean) return null;
  if (clean.toLowerCase() === ADMIN_NAME.toLowerCase()) {
    return {
      id: ADMIN_NAME,
      name: ADMIN_NAME,
      initials: "EM",
      role: "admin",
      baseRole: "admin",
      activeRole: "admin",
      allowedRoles: ["admin"],
      isFloater: false,
      active: true,
      isLead: false,
      isAdmin: true,
    };
  }
  const rows = await sbFetch(
    `team_members?name=eq.${encodeURIComponent(clean)}&select=name,initials,color,role,active,is_custom&limit=1`,
    { method: "GET" }
  );
  const member = Array.isArray(rows) ? rows[0] : null;
  if (!member?.name || member.active === false) return null;
  const role = normalizeRole(member.role);
  if (!CANONICAL_ROLES.has(role)) return null;
  const isLead = member.name === MS_LEAD_NAME || member.name === CHASSIS_LEAD_NAME;
  const isFloater = role === ROLE_FLOAT;
  return {
    id: member.name,
    name: member.name,
    initials: member.initials || "",
    color: member.color || "",
    role: isFloater ? ROLE_FLOAT : role,
    baseRole: role,
    activeRole: isFloater ? null : role,
    allowedRoles: isFloater ? [...FLOATER_ALLOWED_ROLES] : [role],
    isFloater,
    active: true,
    isLead,
    isAdmin: role === ROLE_ADMIN,
  };
}

export function requiresPin(user) {
  return !!(user?.isAdmin || user?.isLead);
}

export function requiresRoleSelection(user) {
  return !!(user?.isFloater && !user.activeRole);
}

export function selectTrustedRole(user, requestedRole) {
  const cleanRole = normalizeRole(requestedRole);
  const trusted = normalizeTrustedUser(user);
  if (!trusted?.isFloater) return null;
  if (!trusted.allowedRoles.includes(cleanRole)) return null;
  return normalizeTrustedUser(trusted, { activeRole: cleanRole });
}

export function publicUser(user) {
  const trusted = normalizeTrustedUser(user);
  if (!trusted) return null;
  return {
    id: trusted.id,
    name: trusted.name,
    role: trusted.role,
    baseRole: trusted.baseRole,
    activeRole: trusted.activeRole,
    allowedRoles: trusted.allowedRoles,
    isFloater: trusted.isFloater,
    isLead: trusted.isLead,
    isAdmin: trusted.isAdmin,
  };
}

export function createPasswordHash(password, opts = {}) {
  const iterations = Number(opts.iterations || 210000);
  const salt = opts.salt ? Buffer.from(opts.salt, "base64url") : crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(String(password || ""), salt, iterations, 32, "sha256");
  return `pbkdf2_sha256$${iterations}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2_sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000) return false;
  const salt = fromBase64url(parts[2]);
  const expected = fromBase64url(parts[3]);
  const actual = crypto.pbkdf2Sync(String(password || ""), salt, iterations, expected.length, "sha256");
  return constantTimeEqual(actual, expected);
}

export function verifyGateCredentials(username, password) {
  if (!GATE_USERNAME || !GATE_PASSWORD_HASH) return false;
  const userMatches = constantTimeEqual(normalizeName(username), GATE_USERNAME);
  const passMatches = verifyPassword(password, GATE_PASSWORD_HASH);
  return userMatches && passMatches;
}

export async function verifyPinForUser(userName, pin) {
  const user = await getTrustedUserByName(userName);
  if (!user || !requiresPin(user)) return false;
  const rows = await sbFetch(
    `user_pins?name=eq.${encodeURIComponent(user.name)}&select=name,pin_hash&limit=1`,
    { method: "GET" }
  );
  const record = Array.isArray(rows) ? rows[0] : null;
  if (!record?.pin_hash) return false;
  return verifyPassword(pin, record.pin_hash);
}

export function requireSession(req, res, allowedLevels = ["gate_passed", "pin_required", AUTH_LEVEL_ROLE_REQUIRED, AUTH_LEVEL_AUTHENTICATED]) {
  const session = getSession(req);
  if (!session || !allowedLevels.includes(session.authLevel)) {
    sendJson(res, 401, { error: "Authentication required." });
    return null;
  }
  return session;
}
