import {
  getSession,
  requireMethod,
  sendJson,
  sessionResponse,
  validateOrigin,
} from "../_session.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "GET")) return;
  if (!validateOrigin(req, res)) return;

  const session = getSession(req);
  if (!session) {
    return sendJson(res, 401, {
      authenticated: false,
      gatePassed: false,
      authLevel: "none",
      user: null,
    });
  }

  return sendJson(res, 200, sessionResponse(session));
}
