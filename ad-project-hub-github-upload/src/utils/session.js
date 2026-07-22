export const SESSION_EXPIRED_EVENT = "ad-project-hub:session-expired";

export function signalSessionExpired(message = "登录已失效，请重新登录") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: { message } }));
}

export function handleUnauthorizedResponse(response, payload = null) {
  if (response?.status !== 401) return false;
  signalSessionExpired(payload?.error || "登录已失效，请重新登录");
  return true;
}
