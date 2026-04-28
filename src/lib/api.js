const FUNCTION_BASE = "/.netlify/functions";

async function request(path, options = {}) {
  const response = await fetch(`${FUNCTION_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json().catch(() => ({})) : {};

  if (!isJson) {
    throw new Error("Netlify Functions 未运行。请使用 npx netlify dev，或部署到 Netlify 后访问。");
  }

  if (!response.ok) {
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  return payload;
}

export function loginAdmin(password) {
  return request("/admin-login", {
    method: "POST",
    body: { password }
  });
}

export function fetchPublicSurvey(slug) {
  const params = new URLSearchParams({ slug });
  const previewToken = new URLSearchParams(window.location.search).get("previewToken");
  if (previewToken) params.set("previewToken", previewToken);

  return request(`/public-survey?${params.toString()}`).then((payload) => {
    if (!payload.survey) throw new Error("问卷加载失败：服务端没有返回 survey");
    return payload;
  });
}

export function submitPublicResponse(response) {
  return request("/submit-response", {
    method: "POST",
    body: { response }
  });
}

export function fetchAdminSurveys(token) {
  return request("/admin-surveys", { token });
}

export function saveAdminSurvey(token, survey) {
  return request("/admin-surveys", {
    method: survey.id ? "PUT" : "POST",
    token,
    body: { survey }
  });
}

export function deleteAdminSurvey(token, id) {
  return request(`/admin-surveys?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    token
  });
}

export function fetchAdminResponses(token, surveyId) {
  return request(`/admin-responses?surveyId=${encodeURIComponent(surveyId)}`, { token });
}

export function deleteAdminResponses(token, surveyId, ids) {
  return request(`/admin-responses?surveyId=${encodeURIComponent(surveyId)}`, {
    method: "DELETE",
    token,
    body: { ids }
  });
}

export function clearAdminResponses(token, surveyId) {
  return request(`/admin-responses?surveyId=${encodeURIComponent(surveyId)}`, {
    method: "DELETE",
    token,
    body: { all: true }
  });
}
