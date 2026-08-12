import {
  createSessionToken,
  getJsonBody,
  getTrustedUserByName,
  requireJson,
  requireMethod,
  requireSession,
  requiresPin,
  sendJson,
  setSessionCookie,
  validateOrigin,
} from "../_session.js";

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    baseRole: user.baseRole || null,
    isLead: !!user.isLead,
    isAdmin: !!user.isAdmin,
  };
}

export default async function handler(req, res) {
  if (!requireMethod(req, res, "POST")) return;
  if (!validateOrigin(req, res)) return;
  if (!requireJson(req, res)) return;
  const gateSession = requireSession(req, res, ["gate_passed", "pin_required", "user"]);
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

    setSessionCookie(res, createSessionToken({ authLevel: "user", user }));
    return sendJson(res, 200, {
      ok: true,
      authenticated: true,
      gatePassed: true,
      pinRequired: false,
      user: publicUser(user),
    });
  } catch {
    return sendJson(res, 401, { error: "Unable to select user." });
  }
}
