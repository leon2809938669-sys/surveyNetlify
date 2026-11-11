import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { createApplication } from "../server/app.js";
import { createSession, isAdmin } from "../server/auth.js";
import { openDatabase } from "../server/database.js";

const definition = {
  schema: "custom-survey.v1", id: "test-survey", title: "测试问卷", version: 1,
  pages: [{ id: "page1", title: "基本信息", questions: [
    { id: "name", title: "称呼", type: "text", required: true },
    { id: "score", title: "评分", type: "rating", required: true, scale: { min: 0, max: 5 } },
    { id: "extra", title: "补充", type: "textarea", visibleIf: { questionId: "score", operator: "lte", value: 2 } }
  ] }]
};

async function harness(t) {
  const db = openDatabase(":memory:");
  const config = { password: "test-password-not-a-real-secret", secret: "x".repeat(64), sessionSeconds: 3600, cookieSecure: false, distPath: "/nonexistent-test-dist" };
  const server = createServer(createApplication({ db, config }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); db.close(); });
  let cookie = "";
  async function request(path, { method = "GET", body, auth = false, headers = {}, raw } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}), ...(auth ? { Cookie: cookie } : {}), ...headers },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
    });
    const payload = await response.json();
    return { status: response.status, payload, headers: response.headers };
  }
  async function login() {
    const result = await request("/api/admin-login", { method: "POST", body: { password: config.password } });
    assert.equal(result.status, 200);
    assert.ok(result.headers.get("set-cookie").includes("HttpOnly"));
    assert.ok(result.headers.get("set-cookie").includes("SameSite=Strict"));
    cookie = result.headers.get("set-cookie").split(";")[0];
    assert.equal(result.payload.token, undefined);
    return result;
  }
  async function create(status = "published") {
    await login();
    const result = await request("/api/admin-surveys", { method: "POST", auth: true, body: { survey: { slug: "test-survey", status, definition } } });
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    return result.payload.survey;
  }
  function response(survey) {
    return {
      schema: "custom-survey-response.v1", surveyId: survey.id, surveyVersion: 1,
      respondent: { id: "test-respondent-identifier", source: "public-link", locale: "zh-CN" },
      startedAt: new Date(Date.now() - 5000).toISOString(), submittedAt: new Date().toISOString(), durationMs: 5000,
      answers: [{ questionId: "name", type: "text", value: "匿名测试", textValue: null }, { questionId: "score", type: "rating", value: 5, textValue: null }],
      skipped: [], metadata: { appVersion: "test", isPreview: false }
    };
  }
  return { db, config, request, login, create, response };
}

test("health and session do not expose private configuration", async (t) => {
  const h = await harness(t);
  const health = await h.request("/api/health");
  assert.deepEqual(health.payload, { ok: true, storage: "sqlite", version: "0.2.0" });
  assert.deepEqual((await h.request("/api/admin-session")).payload, { authenticated: false });
  assert.equal((await h.request("/api/admin-surveys")).status, 401);
  assert.equal((await h.request("/api/admin-backup")).status, 401);
  assert.equal((await h.request("/.env")).status, 404);
  assert.equal((await h.request("/assets/../../server/config.js")).status, 404);
});

test("login, cookie session, logout and cross-origin protection", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("/api/admin-login", { method: "POST", body: { password: "wrong" } })).status, 401);
  await h.login();
  assert.equal((await h.request("/api/admin-session", { auth: true })).payload.authenticated, true);
  assert.equal((await h.request("/api/admin-login", { method: "POST", body: { password: h.config.password }, headers: { Origin: "https://other.example" } })).status, 403);
  assert.equal((await h.request("/api/admin-logout", { method: "POST", body: {}, auth: true })).headers.get("set-cookie").includes("Max-Age=0"), true);
});

test("invalid and expired signed cookies are rejected without server errors", async (t) => {
  const h = await harness(t);
  for (const token of ["bad", "a.b.c", "a." + "测".repeat(43), createSession({ ...h.config, sessionSeconds: -1 })]) {
    const valid = isAdmin({ headers: { cookie: `survey_session=${token}` } }, h.config);
    assert.equal(valid, false);
  }
});

test("login brute force has a bounded rate limit", async (t) => {
  const h = await harness(t);
  for (let i = 0; i < 8; i += 1) assert.equal((await h.request("/api/admin-login", { method: "POST", body: { password: "wrong" } })).status, 401);
  assert.equal((await h.request("/api/admin-login", { method: "POST", body: { password: "wrong" } })).status, 429);
});

test("drafts and preview submissions require an admin session", async (t) => {
  const h = await harness(t);
  const survey = await h.create("unpublished");
  assert.equal((await h.request("/api/public-survey?slug=test-survey")).status, 404);
  assert.equal((await h.request("/api/public-survey?slug=test-survey&preview=1")).status, 401);
  assert.equal((await h.request("/api/public-survey?slug=test-survey&preview=1", { auth: true })).status, 200);
  const response = h.response(survey);
  assert.equal((await h.request("/api/submit-response", { method: "POST", body: { response } })).status, 404);
  response.metadata = { isPreview: true, previewToken: "legacy-test-value-not-a-credential" };
  assert.equal((await h.request("/api/submit-response", { method: "POST", body: { response } })).status, 401);
  const submitted = await h.request("/api/submit-response", { method: "POST", auth: true, body: { response } });
  assert.equal(submitted.status, 200);
  const saved = JSON.parse(h.db.prepare("SELECT response FROM survey_responses").get().response);
  assert.equal(saved.metadata.previewToken, undefined);
  assert.equal(saved.metadata.isPreview, true);
});

test("create, publish, submit, list, export and scoped delete retain the data contract", async (t) => {
  const h = await harness(t);
  const survey = await h.create();
  const publicSurvey = await h.request("/api/public-survey?slug=test-survey");
  assert.equal(publicSurvey.payload.survey.id, survey.id);
  assert.deepEqual(publicSurvey.payload.survey.pages, definition.pages);
  const submitted = await h.request("/api/submit-response", { method: "POST", body: { response: h.response(survey) } });
  assert.equal(submitted.status, 200);
  const list = await h.request(`/api/admin-responses?surveyId=${survey.id}`, { auth: true });
  assert.equal(list.payload.responses.length, 1);
  assert.equal(list.payload.responses[0].survey_id, survey.id);
  assert.equal(list.payload.responses[0].response.answers[0].value, "匿名测试");
  assert.equal(list.payload.responses[0].submission_key, undefined);
  assert.equal((await h.request("/api/admin-surveys", { auth: true })).payload.surveys[0].responseCount, 1);
  const backup = await h.request("/api/admin-backup", { auth: true });
  assert.equal(backup.payload.schema, "survey-backup.v1");
  assert.equal(backup.payload.survey_responses.length, 1);
  assert.equal((await h.request(`/api/admin-surveys?id=${survey.id}`, { auth: true, method: "DELETE" })).status, 409);
  await h.request("/api/admin-responses?surveyId=other-survey", { auth: true, method: "DELETE", body: { ids: [submitted.payload.id] } });
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM survey_responses").get().count, 1);
  await h.request(`/api/admin-responses?surveyId=${survey.id}`, { auth: true, method: "DELETE", body: { ids: [submitted.payload.id] } });
  assert.equal((await h.request(`/api/admin-surveys?id=${survey.id}`, { auth: true, method: "DELETE" })).status, 200);
});

test("idempotent retries save only one response", async (t) => {
  const h = await harness(t);
  const survey = await h.create();
  const response = h.response(survey);
  const options = { method: "POST", body: { response }, headers: { "Idempotency-Key": "test-stable-submission-key" } };
  const first = await h.request("/api/submit-response", options);
  const second = await h.request("/api/submit-response", options);
  assert.equal(first.status, 200);
  assert.equal(second.payload.id, first.payload.id);
  assert.equal(second.payload.duplicate, true);
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM survey_responses").get().count, 1);
  response.answers[0].value = "Changed";
  assert.equal((await h.request("/api/submit-response", options)).status, 409);
});

test("server validates all pages, answer types, versions and duplicate IDs", async (t) => {
  const h = await harness(t);
  const survey = await h.create();
  const invalid = [
    { ...h.response(survey), answers: [] },
    { ...h.response(survey), surveyVersion: 2 },
    { ...h.response(survey), answers: [...h.response(survey).answers, h.response(survey).answers[0]] },
    { ...h.response(survey), answers: [h.response(survey).answers[0], { questionId: "score", type: "rating", value: 100 }] },
    { ...h.response(survey), answers: [{ questionId: "name", type: "text", value: {} }, h.response(survey).answers[1]] }
  ];
  for (const response of invalid) assert.ok([400, 409].includes((await h.request("/api/submit-response", { method: "POST", body: { response } })).status));
  assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM survey_responses").get().count, 0);
});

test("slug conflicts and optimistic edit conflicts return useful 409 errors", async (t) => {
  const h = await harness(t);
  const survey = await h.create();
  const duplicate = await h.request("/api/admin-surveys", { auth: true, method: "POST", body: { survey: { slug: survey.slug, definition } } });
  assert.equal(duplicate.status, 409);
  const conflict = await h.request("/api/admin-surveys", { auth: true, method: "PUT", body: { survey: { ...survey, updatedAt: "not-the-current-revision" } } });
  assert.equal(conflict.status, 409);
});

test("malformed JSON, oversized bodies and unknown APIs are handled safely", async (t) => {
  const h = await harness(t);
  assert.equal((await h.request("/api/admin-login", { method: "POST", raw: "{invalid" })).status, 400);
  assert.equal((await h.request("/api/admin-login", { method: "POST", raw: JSON.stringify({ password: "x".repeat(1024 * 1024) }) })).status, 413);
  assert.equal((await h.request("/api/admin-login")).status, 405);
  assert.equal((await h.request("/api/not-found")).status, 404);
});
