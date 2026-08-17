import {
  getJsonBody,
  requireJson,
  requireMethod,
  requireSession,
  sendJson,
  sessionUser,
  validateOrigin,
} from "./_session.js";

const P1_API_URL = process.env.P1_API_URL || "";
const P1_API_KEY = process.env.P1_API_KEY || "";
const MONDAY_API_KEY = process.env.MONDAY_API_KEY || "";

const AUTHENTICATED = "authenticated";
const ROLE_ADMIN = "admin";
const ROLE_CHASSIS = "chassis";
const ROLE_CONFIG = "config";
const ROLE_KIT = "kit";
const ROLE_MS = "ms";

const P1_APPROVED_HOSTNAME = "submission-api-331638234113.us-central1.run.app";
const MONDAY_FILE_URL = "https://api.monday.com/v2/file";
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_UPLOAD_BYTES / 3);
const MAX_PICKLIST_ITEMS = 2_000;

const OPERATION_POLICIES = Object.freeze({
  "p1.time.event": Object.freeze({ enabled: false, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_MS] }),
  "p1.time.complete": Object.freeze({ enabled: false, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_MS] }),
  "p1.picklist.get": Object.freeze({ enabled: true, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_CONFIG, ROLE_KIT, ROLE_MS] }),
  "p1.picklist.submit": Object.freeze({ enabled: false, roles: [ROLE_ADMIN, ROLE_KIT] }),
  "monday.file.attachToUpdate": Object.freeze({ enabled: true, roles: [ROLE_CHASSIS, ROLE_MS] }),
});

function cleanString(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function controlledError(status, code, error) {
  return { status, data: { ok: false, error, code } };
}

function sendControlledError(res, status, code, error) {
  return sendJson(res, status, { ok: false, error, code });
}

function requireOperationPolicy(res, operation, user) {
  const policy = OPERATION_POLICIES[operation];
  if (!policy) {
    sendControlledError(res, 403, "OPERATION_NOT_ALLOWED", "Operation is not allowed.");
    return null;
  }

  const role = String(user?.role || "").trim().toLowerCase();
  if (!policy.roles.includes(role)) {
    sendControlledError(res, 403, "OPERATION_NOT_ALLOWED", "Operation is not allowed.");
    return null;
  }
  if (!policy.enabled) {
    sendControlledError(res, 403, "OPERATION_DISABLED", "Operation is temporarily unavailable.");
    return null;
  }
  return policy;
}

function normalizeWorkOrder(value) {
  const normalized = cleanString(value, 32).toUpperCase().replace(/\s+/g, "");
  return /^[A-Z]{0,3}\d{4,12}$/.test(normalized) ? normalized : "";
}

function normalizeMondayId(value) {
  const id = cleanString(value, 32);
  return /^\d{1,20}$/.test(id) ? id : "";
}

function normalizeMimeType(value) {
  const mimeType = cleanString(value, 120).toLowerCase();
  return /^(image\/(jpeg|jpg|png|webp|heic)|application\/pdf)$/.test(mimeType) ? mimeType : "";
}

function normalizeFilename(value) {
  if (value === undefined || value === null || value === "") return "upload.bin";
  if (typeof value !== "string") return "";
  const filename = value.trim();
  if (!filename || filename.length > 120) return "";
  return filename.replace(/[^\w.\- ]/g, "_");
}

function validateBase64(value) {
  if (typeof value !== "string") return { error: "invalid" };
  let raw = value.trim();
  if (raw.startsWith("data:")) {
    const comma = raw.indexOf(",");
    const header = comma === -1 ? "" : raw.slice(0, comma);
    if (!header || header.length > 200 || !/;base64$/i.test(header)) return { error: "invalid" };
    raw = raw.slice(comma + 1);
  }
  if (raw.length > MAX_BASE64_CHARS) return { error: "too_large" };
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) {
    return { error: "invalid" };
  }
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  const decodedBytes = (raw.length / 4) * 3 - padding;
  if (decodedBytes > MAX_UPLOAD_BYTES) return { error: "too_large" };
  return { raw, decodedBytes };
}

function getP1BaseUrl() {
  try {
    const url = new URL(P1_API_URL);
    const validPath = url.pathname === "/" || url.pathname === "";
    if (
      url.protocol !== "https:" ||
      url.hostname !== P1_APPROVED_HOSTNAME ||
      url.port ||
      url.username ||
      url.password ||
      !validPath ||
      url.search ||
      url.hash
    ) {
      return "";
    }
    return `https://${P1_APPROVED_HOSTNAME}`;
  } catch {
    return "";
  }
}

function requireP1Configuration(res) {
  const baseUrl = getP1BaseUrl();
  if (baseUrl && P1_API_KEY) return baseUrl;
  sendControlledError(res, 503, "PROXY_NOT_CONFIGURED", "Proxy operation is not configured.");
  return "";
}

function requireMondayConfiguration(res) {
  if (MONDAY_API_KEY) return true;
  sendControlledError(res, 503, "PROXY_NOT_CONFIGURED", "Proxy operation is not configured.");
  return false;
}

function upstreamFailure(provider, upstreamStatus = 0) {
  if (upstreamStatus === 429) {
    return controlledError(429, `${provider}_RATE_LIMITED`, "Upstream service is temporarily rate limited.");
  }
  if (upstreamStatus === 404) {
    return controlledError(502, `${provider}_RESOURCE_NOT_FOUND`, "Upstream resource was not found.");
  }
  return controlledError(502, `${provider}_UPSTREAM_ERROR`, "Upstream request failed.");
}

async function fetchUpstreamJson(provider, url, options) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return { error: upstreamFailure(provider, response.status) };

    const text = await response.text();
    try {
      return { data: text ? JSON.parse(text) : null };
    } catch {
      return { error: controlledError(502, `${provider}_INVALID_RESPONSE`, "Upstream returned an invalid response.") };
    }
  } catch (error) {
    if (timedOut || error?.name === "AbortError") {
      return { error: controlledError(504, `${provider}_TIMEOUT`, "Upstream request timed out.") };
    }
    return { error: controlledError(502, `${provider}_CONNECTION_ERROR`, "Upstream request failed.") };
  } finally {
    clearTimeout(timeoutId);
  }
}

function boundedUpstreamString(value, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > maxLength) return null;
  return value.trim();
}

function sanitizePickListSuccess(data) {
  if (!data || !Array.isArray(data.items) || data.items.length > MAX_PICKLIST_ITEMS) return null;
  const items = [];
  for (const item of data.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const customerName = boundedUpstreamString(item.customer_name, 200);
    const brand = boundedUpstreamString(item.brand, 200);
    const itemName = boundedUpstreamString(item.item_name, 500);
    const memo = boundedUpstreamString(item.memo, 1_000);
    const description = boundedUpstreamString(item.description, 1_000);
    const quantity = Number(item.quantity ?? 1);
    if (
      customerName === null ||
      brand === null ||
      itemName === null ||
      memo === null ||
      description === null ||
      !itemName ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 1_000
    ) {
      return null;
    }
    items.push({ customer_name: customerName, brand, item_name: itemName, memo, description, quantity });
  }
  return { items };
}

async function getP1PickList(baseUrl, woNumber) {
  const result = await fetchUpstreamJson("P1", `${baseUrl}/picklist?wo=${encodeURIComponent(woNumber)}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": P1_API_KEY,
    },
  });
  if (result.error) return result.error;
  const data = sanitizePickListSuccess(result.data);
  return data
    ? { status: 200, data }
    : controlledError(502, "P1_INVALID_RESPONSE", "Upstream returned an invalid response.");
}

function requireMondayFileParams(res, params = {}) {
  const file = validateBase64(params.fileBase64);
  if (file.error === "too_large") {
    sendControlledError(res, 413, "UPLOAD_TOO_LARGE", "File exceeds the upload size limit.");
    return null;
  }
  const filename = normalizeFilename(params.filename);
  const mimeType = normalizeMimeType(params.mimeType);
  if (file.error || !filename || !mimeType) {
    sendControlledError(res, 400, "INVALID_UPLOAD", "Invalid file upload parameters.");
    return null;
  }
  return { fileBase64: file.raw, decodedBytes: file.decodedBytes, filename, mimeType };
}

async function uploadMondayFile({ query, fileBase64, decodedBytes, filename, mimeType }) {
  const boundary = "----ProductionTrackerBoundary" + Date.now();
  const fileBuffer = Buffer.from(fileBase64, "base64");
  if (fileBuffer.length !== decodedBytes) {
    return controlledError(400, "INVALID_UPLOAD", "Invalid file upload parameters.");
  }

  let bodyStr = "";
  bodyStr += `--${boundary}\r\n`;
  bodyStr += "Content-Disposition: form-data; name=\"query\"\r\n\r\n";
  bodyStr += query + "\r\n";
  bodyStr += `--${boundary}\r\n`;
  bodyStr += `Content-Disposition: form-data; name=\"variables[file]\"; filename=\"${filename}\"\r\n`;
  bodyStr += `Content-Type: ${mimeType}\r\n\r\n`;

  const bodyStart = Buffer.from(bodyStr, "utf8");
  const bodyEnd = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const fullBody = Buffer.concat([bodyStart, fileBuffer, bodyEnd]);

  const result = await fetchUpstreamJson("MONDAY", MONDAY_FILE_URL, {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_KEY,
      "API-Version": "2024-01",
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: fullBody,
  });
  if (result.error) return result.error;
  if (Array.isArray(result.data?.errors) && result.data.errors.length) {
    return upstreamFailure("MONDAY", 502);
  }
  const updateId = normalizeMondayId(result.data?.data?.add_file_to_update?.id);
  return updateId
    ? { status: 200, data: { data: { add_file_to_update: { id: updateId } } } }
    : controlledError(502, "MONDAY_INVALID_RESPONSE", "Upstream returned an invalid response.");
}

async function handleOperation(operation, params, user, res) {
  if (!requireOperationPolicy(res, operation, user)) return null;

  switch (operation) {
    case "p1.picklist.get": {
      const baseUrl = requireP1Configuration(res);
      if (!baseUrl) return null;
      const woNumber = normalizeWorkOrder(params.wo);
      if (!woNumber) {
        sendControlledError(res, 400, "INVALID_WORK_ORDER", "Invalid work order.");
        return null;
      }
      return getP1PickList(baseUrl, woNumber);
    }

    case "monday.file.attachToUpdate": {
      if (!requireMondayConfiguration(res)) return null;
      const upload = requireMondayFileParams(res, params);
      const updateId = normalizeMondayId(params.updateId);
      if (!upload) return null;
      if (!updateId) {
        sendControlledError(res, 400, "INVALID_UPLOAD", "Invalid Monday upload parameters.");
        return null;
      }
      return uploadMondayFile({
        ...upload,
        query: `mutation ($file: File!) { add_file_to_update(update_id:${updateId}, file:$file) { id } }`,
      });
    }

    default:
      sendControlledError(res, 403, "OPERATION_NOT_ALLOWED", "Operation is not allowed.");
      return null;
  }
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;
  if (!requireJson(req, res)) return;

  const session = requireSession(req, res, [AUTHENTICATED]);
  if (!session) return;

  const user = sessionUser(session);
  if (!user) return sendControlledError(res, 401, "AUTHENTICATION_REQUIRED", "Authentication required.");

  try {
    const { operation, params = {} } = getJsonBody(req);
    const op = cleanString(operation, 80);
    const safeParams = params && typeof params === "object" && !Array.isArray(params) ? params : {};
    const result = await handleOperation(op, safeParams, user, res);
    if (!result) return;
    return sendJson(res, result.status, result.data);
  } catch {
    return sendControlledError(res, 500, "PROXY_ERROR", "Proxy operation failed.");
  }
}
