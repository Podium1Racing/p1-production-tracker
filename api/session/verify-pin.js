import {
  createSessionToken,
  getJsonBody,
  publicUser,
  requireJson,
  requireMethod,
  requireSession,
  requiresRoleSelection,
  sendJson,
  sessionUser,
  setSessionCookie,
  validateOrigin,
  verifyPinForUser,
} from "../_session.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;
  if (!requireJson(req, res)) return;
  const pendingSession = requireSession(req, res, ["pin_required"]);
  if (!pendingSession) return;

  try {
    const user = sessionUser(pendingSession);
    const { pin } = getJsonBody(req);
    if (!user || !await verifyPinForUser(user.name, pin)) {
      return sendJson(res, 401, { error: "Invalid credentials." });
    }
    if (requiresRoleSelection(user)) {
      setSessionCookie(res, createSessionToken({ authLevel: "role_required", user }));
      return sendJson(res, 200, {
        ok: true,
        authenticated: false,
        gatePassed: true,
        roleRequired: true,
        authLevel: "role_required",
        user: publicUser(user),
      });
    }

    setSessionCookie(res, createSessionToken({ authLevel: "authenticated", user }));
    return sendJson(res, 200, {
      ok: true,
      authenticated: true,
      gatePassed: true,
      authLevel: "authenticated",
      user: publicUser(user),
    });
  } catch {
    return sendJson(res, 401, { error: "Invalid credentials." });
  }
}
