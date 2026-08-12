import {
  clearSessionCookie,
  requireMethod,
  sendJson,
  validateOrigin,
} from "../_session.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;

  clearSessionCookie(res);
  return sendJson(res, 200, { ok: true, authenticated: false, gatePassed: false });
}
