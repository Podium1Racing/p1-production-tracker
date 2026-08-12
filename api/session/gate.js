import {
  createSessionToken,
  getJsonBody,
  requireJson,
  requireMethod,
  sendJson,
  setSessionCookie,
  validateOrigin,
  verifyGateCredentials,
} from "../_session.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;
  if (!requireJson(req, res)) return;

  try {
    const { username, password } = getJsonBody(req);
    if (!verifyGateCredentials(username, password)) {
      return sendJson(res, 401, { error: "Invalid credentials." });
    }
    setSessionCookie(res, createSessionToken({ authLevel: "gate_passed" }));
    return sendJson(res, 200, { ok: true, authenticated: false, gatePassed: true });
  } catch {
    return sendJson(res, 401, { error: "Invalid credentials." });
  }
}
