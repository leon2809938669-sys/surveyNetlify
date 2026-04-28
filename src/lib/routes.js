export function getRoute() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return { name: "admin" };
  }

  if (pathname.startsWith("/s/")) {
    return { name: "survey", slug: decodeURIComponent(pathname.replace("/s/", "").split("/")[0]) };
  }

  return { name: "survey", slug: params.get("survey") || "customer-feedback-2026" };
}

export function getPublicSurveyUrl(slug) {
  return `${window.location.origin}/s/${encodeURIComponent(slug)}`;
}
