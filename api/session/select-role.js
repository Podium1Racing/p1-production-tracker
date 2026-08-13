import {
  createSessionToken,
  getJsonBody,
  getTrustedUserByName,
  publicUser,
  requireJson,
  requireMethod,
  requireSession,
  selectTrustedRole,
  sendJson,
  sessionUser,
  setSessionCookie,
  validateOrigin,
} from "../_session.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;
  if (!requireJson(req, res)) return;
  const session = requireSession(req, res, ["role_required", "authenticated"]);
  if (!session) return;

  try {
    const sessionUserState = sessionUser(session);
    const { role } = getJsonBody(req);
    const trustedUser = await getTrustedUserByName(sessionUserState?.name);
    const selectedUser = selectTrustedRole(trustedUser, role);
    if (!selectedUser) {
      return sendJson(res, 403, { error: "Role selection is not allowed." });
    }

    setSessionCookie(res, createSessionToken({ authLevel: "authenticated", user: selectedUser }));
    return sendJson(res, 200, {
      ok: true,
      authenticated: true,
      gatePassed: true,
      roleRequired: false,
      authLevel: "authenticated",
      user: publicUser(selectedUser),
    });
  } catch {
    return sendJson(res, 403, { error: "Role selection is not allowed." });
  }
}
