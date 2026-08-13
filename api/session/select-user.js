import {
  createSessionToken,
  getJsonBody,
  getTrustedUserByName,
  publicUser,
  requireJson,
  requireMethod,
  requireSession,
  requiresPin,
  requiresRoleSelection,
  sendJson,
  setSessionCookie,
  validateOrigin,
} from "../_session.js";

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;
  if (!requireJson(req, res)) return;
  const gateSession = requireSession(req, res, ["gate_passed", "pin_required", "role_required", "authenticated"]);
  if (!gateSession) return;

  try {
    const { name } = getJsonBody(req);
    const user = await getTrustedUserByName(name);
    if (!user) return sendJson(res, 401, { error: "Unable to select user." });

    if (requiresPin(user)) {
      setSessionCookie(res, createSessionToken({ authLevel: "pin_required", user }));
      return sendJson(res, 200, {
        ok: true,
        authenticated: false,
        gatePassed: true,
        pinRequired: true,
        user: publicUser(user),
      });
    }

    if (requiresRoleSelection(user)) {
      setSessionCookie(res, createSessionToken({ authLevel: "role_required", user }));
      return sendJson(res, 200, {
        ok: true,
        authenticated: false,
        gatePassed: true,
        pinRequired: false,
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
      pinRequired: false,
      authLevel: "authenticated",
      user: publicUser(user),
    });
  } catch {
    return sendJson(res, 401, { error: "Unable to select user." });
  }
}
