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
const ALL_APP_ROLES = Object.freeze([ROLE_ADMIN, ROLE_CHASSIS, ROLE_CONFIG, ROLE_KIT, ROLE_MS]);

const P1_APPROVED_HOSTNAME = "submission-api-331638234113.us-central1.run.app";
const PRODUCTION_BOARD_ID = "7847112819";
const MONDAY_GRAPHQL_URL = "https://api.monday.com/v2";
const MONDAY_FILE_URL = "https://api.monday.com/v2/file";
const UPSTREAM_TIMEOUT_MS = 12_000;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_UPLOAD_BYTES / 3);
const MAX_PICKLIST_ITEMS = 2_000;
const MAX_MONDAY_ITEM_IDS = 100;
const MAX_MONDAY_PICKLIST_ASSET_BYTES = 3 * 1024 * 1024;
const APPROVED_MONDAY_ASSET_HOSTNAMES = new Set(["files.monday.com", "files-us.monday.com"]);

const MONDAY_PRODUCTION_BOARD_QUERY = `query ProductionBoard {
  boards(ids: [${PRODUCTION_BOARD_ID}]) {
    id
    columns { id title type settings_str }
    subscribers { id name }
    items_page(limit: 200) {
      cursor
      items {
        id name
        group { id title }
        column_values { id type text value ... on StatusValue { updated_at } }
      }
    }
  }
}`;

const MONDAY_ADMIN_BOARD_QUERY = `query AdminBoard {
  boards(ids: [${PRODUCTION_BOARD_ID}]) {
    id
    columns { id title type }
    items_page(limit: 200) {
      cursor
      items {
        id name
        group { id title }
        column_values { id type text value }
      }
    }
  }
}`;

const MONDAY_KIT_BOARD_QUERY = `query KitBoard {
  boards(ids: [${PRODUCTION_BOARD_ID}]) {
    id
    columns { id title type }
    groups { id title }
    subscribers { id name }
    items_page(limit: 200) {
      cursor
      items {
        id name
        group { id title }
        column_values { id text value }
      }
    }
  }
}`;

const MONDAY_SUBSCRIBERS_QUERY = `query BoardSubscribers {
  boards(ids: [${PRODUCTION_BOARD_ID}]) { id subscribers { id name } }
}`;

const MONDAY_GROUPS_QUERY = `query BoardGroups {
  boards(ids: [${PRODUCTION_BOARD_ID}]) { id groups { id title } }
}`;

const MONDAY_ITEMS_QUERY = `query ProductionItems($ids: [ID!]!) {
  items(ids: $ids) {
    id name
    board { id }
    group { id title }
    column_values { id type text value }
  }
}`;

const MONDAY_ITEM_ASSETS_QUERY = `query ProductionItemAssets($ids: [ID!]!) {
  items(ids: $ids) {
    id
    board { id }
    assets { id name url public_url file_extension }
  }
}`;

const OPERATION_POLICIES = Object.freeze({
  "p1.time.event": Object.freeze({ enabled: false, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_MS] }),
  "p1.time.complete": Object.freeze({ enabled: false, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_MS] }),
  "p1.picklist.get": Object.freeze({ enabled: true, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_CONFIG, ROLE_KIT, ROLE_MS] }),
  "p1.picklist.submit": Object.freeze({ enabled: false, roles: [ROLE_ADMIN, ROLE_KIT] }),
  "monday.file.attachToUpdate": Object.freeze({ enabled: true, roles: [ROLE_CHASSIS, ROLE_MS] }),
  "monday.board.production.get": Object.freeze({ enabled: true, roles: ALL_APP_ROLES }),
  "monday.board.admin.get": Object.freeze({ enabled: true, roles: [ROLE_ADMIN] }),
  "monday.board.kit.get": Object.freeze({ enabled: true, roles: [ROLE_ADMIN, ROLE_KIT] }),
  "monday.board.subscribers.get": Object.freeze({ enabled: true, roles: [ROLE_ADMIN, ROLE_CHASSIS, ROLE_MS] }),
  "monday.board.groups.get": Object.freeze({ enabled: true, roles: ALL_APP_ROLES }),
  "monday.items.get": Object.freeze({ enabled: true, roles: ALL_APP_ROLES }),
  "monday.asset.picklist.get": Object.freeze({ enabled: true, roles: ALL_APP_ROLES }),
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

function normalizeMondayItemIds(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_MONDAY_ITEM_IDS) return null;
  const ids = value.map(normalizeMondayId);
  if (ids.some(id => !id)) return null;
  return [...new Set(ids)];
}

function normalizeOptionalMondayId(value) {
  if (value === undefined || value === null || value === "") return "";
  return normalizeMondayId(value);
}

function hasOnlyParamKeys(params, allowedKeys) {
  return Object.keys(params || {}).every(key => allowedKeys.includes(key));
}

function normalizeMondayAssetUrl(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !APPROVED_MONDAY_ASSET_HOSTNAMES.has(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
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

async function runMondayGraphql(query, variables = {}) {
  const result = await fetchUpstreamJson("MONDAY", MONDAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: MONDAY_API_KEY,
      "API-Version": "2024-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  if (result.error) return result.error;
  if (
    !result.data ||
    typeof result.data !== "object" ||
    !result.data.data ||
    typeof result.data.data !== "object" ||
    (Array.isArray(result.data.errors) && result.data.errors.length)
  ) {
    return controlledError(502, "MONDAY_INVALID_RESPONSE", "Upstream returned an invalid response.");
  }
  return { status: 200, data: result.data };
}

function mondayInvalidResponse(code = "MONDAY_INVALID_RESPONSE") {
  return controlledError(502, code, "Upstream returned an invalid response.");
}

function requireMondayBoard(data) {
  const boards = data?.data?.boards;
  const board = Array.isArray(boards) && boards.length === 1 ? boards[0] : null;
  if (!board || normalizeMondayId(board.id) !== PRODUCTION_BOARD_ID) return null;
  return board;
}

function isValidItemsPage(itemsPage) {
  return !!(
    itemsPage &&
    typeof itemsPage === "object" &&
    !Array.isArray(itemsPage) &&
    Object.prototype.hasOwnProperty.call(itemsPage, "cursor") &&
    (itemsPage.cursor === null || typeof itemsPage.cursor === "string") &&
    Array.isArray(itemsPage.items)
  );
}

function sanitizeProductionBoard(data) {
  const board = requireMondayBoard(data);
  if (
    !board ||
    !Array.isArray(board.columns) ||
    !Array.isArray(board.subscribers) ||
    !isValidItemsPage(board.items_page)
  ) {
    return null;
  }
  const { id, ...safeBoard } = board;
  return safeBoard;
}

function sanitizeAdminBoard(data) {
  const board = requireMondayBoard(data);
  if (
    !board ||
    !Array.isArray(board.columns) ||
    !isValidItemsPage(board.items_page)
  ) {
    return null;
  }
  const { id, ...safeBoard } = board;
  return safeBoard;
}

function sanitizeKitBoard(data) {
  const board = requireMondayBoard(data);
  if (
    !board ||
    !Array.isArray(board.columns) ||
    !Array.isArray(board.groups) ||
    !Array.isArray(board.subscribers) ||
    !isValidItemsPage(board.items_page)
  ) {
    return null;
  }
  const { id, ...safeBoard } = board;
  return safeBoard;
}

function sanitizeSubscribersBoard(data) {
  const board = requireMondayBoard(data);
  if (!board || !Array.isArray(board.subscribers)) return null;
  const { id, ...safeBoard } = board;
  return safeBoard;
}

function sanitizeGroupsBoard(data) {
  const board = requireMondayBoard(data);
  if (!board || !Array.isArray(board.groups)) return null;
  const { id, ...safeBoard } = board;
  return safeBoard;
}

async function getMondayBoard(query, sanitizeBoard) {
  const result = await runMondayGraphql(query);
  if (result.status !== 200) return result;
  const board = sanitizeBoard(result.data);
  if (!board) {
    return mondayInvalidResponse();
  }
  if (board.items_page?.cursor) {
    return mondayInvalidResponse("BOARD_RESULT_INCOMPLETE");
  }
  return { status: 200, data: { data: { boards: [board] } } };
}

async function getMondayItems(itemIds) {
  const result = await runMondayGraphql(MONDAY_ITEMS_QUERY, { ids: itemIds });
  if (result.status !== 200) return result;
  const items = result.data?.data?.items;
  if (!Array.isArray(items) || items.length !== itemIds.length) {
    return controlledError(404, "MONDAY_RESOURCE_NOT_FOUND", "Requested item was not found.");
  }

  const requestedIds = new Set(itemIds);
  const safeItems = [];
  for (const item of items) {
    const itemId = normalizeMondayId(item?.id);
    const boardId = normalizeMondayId(item?.board?.id);
    if (!itemId || !requestedIds.has(itemId) || boardId !== PRODUCTION_BOARD_ID) {
      return controlledError(404, "MONDAY_RESOURCE_NOT_FOUND", "Requested item was not found.");
    }
    const { board, ...safeItem } = item;
    safeItems.push(safeItem);
  }
  return { status: 200, data: { data: { items: safeItems } } };
}

function findPickListAsset(assets, { assetId, assetUrl }) {
  const candidates = assets.filter(asset => {
    const extension = String(asset?.file_extension || "").trim().toLowerCase();
    const name = String(asset?.name || "").trim().toLowerCase();
    return extension === "pdf" || name.includes("pick") || name.includes("work");
  });
  return candidates.find(asset => {
    const idMatches = assetId && normalizeMondayId(asset?.id) === assetId;
    const urls = [asset?.url, asset?.public_url].map(normalizeMondayAssetUrl).filter(Boolean);
    const urlMatches = assetUrl && urls.includes(assetUrl);
    return assetId || assetUrl ? idMatches || urlMatches : false;
  }) || null;
}

function getAssetFetchUrl(asset) {
  const primary = normalizeMondayAssetUrl(asset?.url);
  const fallback = normalizeMondayAssetUrl(asset?.public_url);
  return primary || fallback || "";
}

function isAllowedPdfContentType(value) {
  const type = String(value || "").split(";")[0].trim().toLowerCase();
  return ["application/pdf", "application/octet-stream", "application/x-pdf", "binary/octet-stream"].includes(type);
}

async function readBoundedResponseBytes(response, maxBytes) {
  const declaredLength = Number(response.headers?.get?.("content-length") || 0);
  if (declaredLength && declaredLength > maxBytes) {
    return { error: controlledError(413, "ASSET_TOO_LARGE", "Asset exceeds the size limit.") };
  }

  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      return { error: controlledError(413, "ASSET_TOO_LARGE", "Asset exceeds the size limit.") };
    }
    return { buffer };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      return { error: controlledError(413, "ASSET_TOO_LARGE", "Asset exceeds the size limit.") };
    }
    chunks.push(chunk);
  }
  return { buffer: Buffer.concat(chunks, total) };
}

function upstreamAssetFailure(upstreamStatus = 0) {
  if (upstreamStatus === 429) {
    return controlledError(429, "MONDAY_RATE_LIMITED", "Upstream service is temporarily rate limited.");
  }
  if (upstreamStatus === 404) {
    return controlledError(404, "ASSET_NOT_FOUND", "Requested asset was not found.");
  }
  if (upstreamStatus >= 300 && upstreamStatus < 400) {
    return controlledError(502, "MONDAY_INVALID_REDIRECT", "Upstream returned an invalid redirect.");
  }
  return controlledError(502, "MONDAY_UPSTREAM_ERROR", "Upstream request failed.");
}

async function fetchMondayAssetBytes(assetUrl, includeAuthorization = true, redirectCount = 0) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, UPSTREAM_TIMEOUT_MS);

  try {
    const headers = includeAuthorization ? { Authorization: MONDAY_API_KEY } : {};
    const response = await fetch(assetUrl, { method: "GET", headers, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      if (redirectCount >= 1) return controlledError(502, "MONDAY_INVALID_REDIRECT", "Upstream returned an invalid redirect.");
      const location = response.headers?.get?.("location") || "";
      const redirectUrl = normalizeMondayAssetUrl(location);
      if (!redirectUrl) return controlledError(502, "MONDAY_INVALID_REDIRECT", "Upstream returned an invalid redirect.");
      const original = new URL(assetUrl);
      const redirected = new URL(redirectUrl);
      const sameOrigin = original.origin === redirected.origin;
      return fetchMondayAssetBytes(redirectUrl, sameOrigin, redirectCount + 1);
    }
    if (!response.ok) return upstreamAssetFailure(response.status);
    if (!isAllowedPdfContentType(response.headers?.get?.("content-type"))) {
      return controlledError(502, "UNEXPECTED_ASSET_TYPE", "Upstream returned an unexpected asset type.");
    }

    const body = await readBoundedResponseBytes(response, MAX_MONDAY_PICKLIST_ASSET_BYTES);
    if (body.error) return body.error;
    if (!body.buffer.subarray(0, 5).toString("utf8").startsWith("%PDF")) {
      return controlledError(502, "UNEXPECTED_ASSET_TYPE", "Upstream returned an unexpected asset type.");
    }
    return {
      status: 200,
      data: {
        mimeType: "application/pdf",
        contentBase64: body.buffer.toString("base64"),
      },
    };
  } catch (error) {
    if (timedOut || error?.name === "AbortError") {
      return controlledError(504, "MONDAY_TIMEOUT", "Upstream request timed out.");
    }
    return controlledError(502, "MONDAY_CONNECTION_ERROR", "Upstream request failed.");
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getMondayPickListAsset(params = {}) {
  if (!hasOnlyParamKeys(params, ["itemId", "assetId", "assetUrl"])) {
    return controlledError(400, "INVALID_PARAMETERS", "Invalid operation parameters.");
  }
  const itemId = normalizeMondayId(params.itemId);
  const assetId = normalizeOptionalMondayId(params.assetId);
  const assetUrl = normalizeMondayAssetUrl(params.assetUrl);
  if (!itemId || assetId === null || assetUrl === null || (!assetId && !assetUrl)) {
    return controlledError(400, "INVALID_ASSET_REFERENCE", "Invalid Monday asset reference.");
  }

  const result = await runMondayGraphql(MONDAY_ITEM_ASSETS_QUERY, { ids: [itemId] });
  if (result.status !== 200) return result;
  const item = Array.isArray(result.data?.data?.items) ? result.data.data.items[0] : null;
  if (!item || normalizeMondayId(item.id) !== itemId || normalizeMondayId(item.board?.id) !== PRODUCTION_BOARD_ID) {
    return controlledError(404, "ASSET_NOT_FOUND", "Requested asset was not found.");
  }
  const assets = Array.isArray(item.assets) ? item.assets : null;
  if (!assets) return mondayInvalidResponse();
  const asset = findPickListAsset(assets, { assetId, assetUrl });
  if (!asset) return controlledError(404, "ASSET_NOT_FOUND", "Requested asset was not found.");
  const fetchUrl = getAssetFetchUrl(asset);
  if (!fetchUrl) return controlledError(404, "ASSET_NOT_FOUND", "Requested asset was not found.");
  return fetchMondayAssetBytes(fetchUrl);
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

    case "monday.board.production.get":
    case "monday.board.admin.get":
    case "monday.board.kit.get":
    case "monday.board.subscribers.get":
    case "monday.board.groups.get": {
      if (!hasOnlyParamKeys(params, [])) {
        return controlledError(400, "INVALID_PARAMETERS", "Invalid operation parameters.");
      }
      if (!requireMondayConfiguration(res)) return null;
      const boardOperations = {
        "monday.board.production.get": [MONDAY_PRODUCTION_BOARD_QUERY, sanitizeProductionBoard],
        "monday.board.admin.get": [MONDAY_ADMIN_BOARD_QUERY, sanitizeAdminBoard],
        "monday.board.kit.get": [MONDAY_KIT_BOARD_QUERY, sanitizeKitBoard],
        "monday.board.subscribers.get": [MONDAY_SUBSCRIBERS_QUERY, sanitizeSubscribersBoard],
        "monday.board.groups.get": [MONDAY_GROUPS_QUERY, sanitizeGroupsBoard],
      };
      const [query, sanitizeBoard] = boardOperations[operation];
      return getMondayBoard(query, sanitizeBoard);
    }

    case "monday.items.get": {
      if (!hasOnlyParamKeys(params, ["itemIds"])) {
        return controlledError(400, "INVALID_PARAMETERS", "Invalid operation parameters.");
      }
      if (!requireMondayConfiguration(res)) return null;
      const itemIds = normalizeMondayItemIds(params.itemIds);
      if (!itemIds) {
        return controlledError(400, "INVALID_ITEM_IDS", "Invalid Monday item identifiers.");
      }
      return getMondayItems(itemIds);
    }

    case "monday.asset.picklist.get": {
      if (!requireMondayConfiguration(res)) return null;
      return getMondayPickListAsset(params);
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
