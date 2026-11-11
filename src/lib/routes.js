export function getRoute() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return { name: "admin" };
  }

  if (pathname.startsWith("/s/")) {
    const value = pathname.replace("/s/", "").split("/")[0];
    try { return { name: "survey", slug: decodeURIComponent(value) }; }
    catch { return { name: "survey", slug: value }; }
  }

  return params.get("survey") ? { name: "survey", slug: params.get("survey") } : { name: "admin" };
}

export function getPublicSurveyUrl(slug) {
  return `${window.location.origin}/s/${encodeURIComponent(slug)}`;
}

export function getPreviewSurveyUrl(slug) {
  const url = new URL(getPublicSurveyUrl(slug));
  url.searchParams.set("preview", "1");
  return url.toString();
}
