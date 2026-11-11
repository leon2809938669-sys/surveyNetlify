async function request(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: "same-origin",
      signal: options.signal || controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("服务暂时不可用，请稍后再试");
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/admin-login") window.dispatchEvent(new Event("survey:unauthorized"));
      const error = new Error(payload.error || `请求失败（${response.status}）`);
      error.status = response.status;
      error.details = payload.details;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("请求超时，请检查连接后重试");
    if (error instanceof TypeError) throw new Error("无法连接服务器，请检查网络或 SSH 隧道");
    throw error;
  } finally { clearTimeout(timeout); }
}

export const loginAdmin = (password) => request("/admin-login", { method: "POST", body: { password } });
export const fetchAdminSession = () => request("/admin-session");
export const logoutAdmin = () => request("/admin-logout", { method: "POST", body: {} });
export const fetchAdminSurveys = () => request("/admin-surveys");
export const fetchAdminBackup = () => request("/admin-backup");
export const saveAdminSurvey = (survey) => request("/admin-surveys", { method: survey.id ? "PUT" : "POST", body: { survey } });
export const deleteAdminSurvey = (id) => request(`/admin-surveys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
export const fetchAdminResponses = (surveyId) => request(`/admin-responses?surveyId=${encodeURIComponent(surveyId)}`);
export const deleteAdminResponses = (surveyId, ids) => request(`/admin-responses?surveyId=${encodeURIComponent(surveyId)}`, { method: "DELETE", body: { ids } });
export const clearAdminResponses = (surveyId) => request(`/admin-responses?surveyId=${encodeURIComponent(surveyId)}`, { method: "DELETE", body: { all: true } });

export function fetchPublicSurvey(slug, isPreview = false) {
  const params = new URLSearchParams({ slug });
  if (isPreview) params.set("preview", "1");
  return request(`/public-survey?${params}`);
}

export function submitPublicResponse(response) {
  return request("/submit-response", {
    method: "POST", body: { response },
    headers: response.respondent?.id ? { "Idempotency-Key": response.respondent.id } : {}
  });
}
