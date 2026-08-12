import {
  createSessionToken,
  getJsonBody,
  requireJson,
  requireMethod,
  requireSession,
  sendJson,
  sessionUser,
  setSessionCookie,
  validateOrigin,
  verifyPinForUser,
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
  const pendingSession = requireSession(req, res, ["pin_required"]);
  if (!pendingSession) return;

  try {
    const user = sessionUser(pendingSession);
    const { pin } = getJsonBody(req);
    if (!user || !await verifyPinForUser(user.name, pin)) {
      return sendJson(res, 401, { error: "Invalid credentials." });
    }
    setSessionCookie(res, createSessionToken({ authLevel: "user", user }));
    return sendJson(res, 200, {
      ok: true,
      authenticated: true,
      gatePassed: true,
      user: publicUser(user),
    });
  } catch {
    return sendJson(res, 401, { error: "Invalid credentials." });
  }
}
