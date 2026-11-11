import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { checkSameOrigin, createSession, HttpError, isAdmin, matchesPassword, RateLimiter, requireAdmin, sessionCookie } from "./auth.js";
import { decodeResponse, decodeSurvey, exportSnapshot, normalizeSurvey } from "./database.js";
import { validateResponse, validateSurvey } from "./validation.js";

const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function json(response, status, payload, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(payload));
}

function allow(request, methods) {
  if (!methods.includes(request.method)) throw new HttpError(405, "不支持此请求方法");
}

async function readBody(request) {
  const maxBytes = 1024 * 1024;
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "请使用 application/json");
  if (Number(request.headers["content-length"]) > maxBytes) {
    request.resume();
    throw new HttpError(413, "请求内容超过 1 MB 限制");
  }
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let exceeded = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        if (!exceeded) reject(new HttpError(413, "请求内容超过 1 MB 限制"));
        exceeded = true;
        chunks.length = 0;
      } else if (!exceeded) chunks.push(chunk);
    });
    request.on("end", () => {
      if (exceeded) return;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
        resolveBody(body);
      } catch { reject(new HttpError(400, "JSON 格式不正确")); }
    });
    request.on("error", () => reject(new HttpError(400, "请求未完整发送")));
    request.on("aborted", () => reject(new HttpError(400, "请求已中断")));
  });
}

async function serveStatic(request, response, url, distPath) {
  allow(request, ["GET", "HEAD"]);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, "地址格式不正确"); }
  const isPage = pathname === "/" || /^\/admin\/?$/.test(pathname) || /^\/s\/[^/]+\/?$/.test(pathname);
  if (!isPage && !pathname.startsWith("/assets/") && pathname !== "/favicon.svg") throw new HttpError(404, "页面不存在");
  const file = resolve(distPath, isPage ? "index.html" : `.${pathname}`);
  if (!file.startsWith(`${resolve(distPath)}${sep}`)) throw new HttpError(404, "页面不存在");
  let chosen = file;
  let encoding;
  const accepted = request.headers["accept-encoding"] || "";
  for (const [pattern, suffix, value] of [[/\bbr\b/, ".br", "br"], [/\bgzip\b/, ".gz", "gzip"]]) {
    if (pattern.test(accepted) && await stat(file + suffix).then((s) => s.isFile()).catch(() => false)) {
      chosen = file + suffix;
      encoding = value;
      break;
    }
  }
  const info = await stat(chosen).catch(() => null);
  if (!info?.isFile()) throw new HttpError(404, "页面不存在；请先运行 npm run build");
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(file)] || "application/octet-stream",
    "Content-Length": info.size,
    "Cache-Control": isPage ? "no-cache" : "public, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
    ...(encoding ? { "Content-Encoding": encoding } : {})
  });
  if (request.method === "HEAD") return response.end();
  await pipeline(createReadStream(chosen), response);
}

export function createApplication({ db, config }) {
  const logins = new RateLimiter(8, 15 * 60 * 1000);
  const submissions = new RateLimiter(120, 60 * 60 * 1000);
  return async function application(request, response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) return await serveStatic(request, response, url, config.distPath);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) checkSameOrigin(request);
      const ip = request.socket.remoteAddress || "unknown";
      const path = url.pathname;
      if (path === "/api/health") {
        allow(request, ["GET"]);
        db.prepare("SELECT 1").get();
        return json(response, 200, { ok: true, storage: "sqlite", version: "0.2.0" });
      }
      if (path === "/api/admin-session") {
        allow(request, ["GET"]);
        return json(response, 200, { authenticated: isAdmin(request, config) });
      }
      if (path === "/api/admin-login") {
        allow(request, ["POST"]);
        logins.check(ip);
        const { password } = await readBody(request);
        if (!matchesPassword(password, config.password)) {
          logins.hit(ip);
          throw new HttpError(401, "管理密码不正确");
        }
        logins.clear(ip);
        return json(response, 200, { authenticated: true }, { "Set-Cookie": sessionCookie(createSession(config), config) });
      }
      if (path === "/api/admin-logout") {
        allow(request, ["POST"]);
        return json(response, 200, { ok: true }, { "Set-Cookie": sessionCookie("", config) });
      }
      if (path === "/api/admin-backup") {
        requireAdmin(request, config);
        allow(request, ["GET"]);
        return json(response, 200, exportSnapshot(db));
      }
      if (path === "/api/admin-surveys") {
        requireAdmin(request, config);
        allow(request, ["GET", "POST", "PUT", "DELETE"]);
        if (request.method === "GET") {
          const rows = db.prepare(`SELECT s.*, COUNT(r.id) AS response_count FROM surveys s
            LEFT JOIN survey_responses r ON r.survey_id = s.id GROUP BY s.id ORDER BY s.updated_at DESC`).all();
          return json(response, 200, { surveys: rows.map(normalizeSurvey) });
        }
        if (request.method === "DELETE") {
          const id = url.searchParams.get("id");
          if (!id) throw new HttpError(400, "缺少问卷 ID");
          if (db.prepare("SELECT 1 FROM survey_responses WHERE survey_id = ? LIMIT 1").get(id)) throw new HttpError(409, "此问卷已有答卷，请先导出并删除答卷后再删除问卷");
          if (!db.prepare("DELETE FROM surveys WHERE id = ?").run(id).changes) throw new HttpError(404, "问卷不存在");
          return json(response, 200, { ok: true });
        }
        const { survey: input } = await readBody(request);
        const survey = validateSurvey(input);
        const id = request.method === "PUT" ? input.id : randomUUID();
        const existing = request.method === "PUT" ? db.prepare("SELECT * FROM surveys WHERE id = ?").get(id || "") : null;
        if (request.method === "PUT" && !existing) throw new HttpError(404, "问卷不存在");
        if (existing && input.updatedAt && existing.updated_at !== input.updatedAt) throw new HttpError(409, "问卷已在其他窗口修改，请刷新后再编辑");
        const now = new Date().toISOString();
        try {
          if (existing) {
            db.prepare(`UPDATE surveys SET slug=?, status=?, title=?, description=?, version=?, definition=?, updated_at=? WHERE id=?`)
              .run(survey.slug, survey.status, survey.title, survey.description, survey.version, JSON.stringify(survey.definition), now, id);
          } else {
            db.prepare(`INSERT INTO surveys (id, slug, status, title, description, version, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(id, survey.slug, survey.status, survey.title, survey.description, survey.version, JSON.stringify(survey.definition), now, now);
          }
        } catch (error) {
          if (error.message.includes("UNIQUE")) throw new HttpError(409, "这个链接标识已经被使用，请更换一个");
          throw error;
        }
        return json(response, 200, { survey: normalizeSurvey(db.prepare("SELECT * FROM surveys WHERE id = ?").get(id)) });
      }
      if (path === "/api/admin-responses") {
        requireAdmin(request, config);
        allow(request, ["GET", "DELETE"]);
        const surveyId = url.searchParams.get("surveyId");
        if (!surveyId) throw new HttpError(400, "缺少问卷 ID");
        if (request.method === "GET") {
          return json(response, 200, { responses: db.prepare("SELECT * FROM survey_responses WHERE survey_id = ? ORDER BY submitted_at DESC").all(surveyId).map(decodeResponse) });
        }
        const { ids, all } = await readBody(request);
        let result;
        if (all === true) result = db.prepare("DELETE FROM survey_responses WHERE survey_id = ?").run(surveyId);
        else {
          if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some((id) => typeof id !== "string")) throw new HttpError(400, "请提供 1–1000 个答卷 ID");
          result = db.prepare(`DELETE FROM survey_responses WHERE survey_id = ? AND id IN (${ids.map(() => "?").join(",")})`).run(surveyId, ...ids);
        }
        return json(response, 200, { ok: true, deleted: Number(result.changes) });
      }
      if (path === "/api/public-survey") {
        allow(request, ["GET"]);
        const slug = url.searchParams.get("slug");
        if (!slug) throw new HttpError(400, "缺少问卷链接标识");
        const preview = url.searchParams.get("preview") === "1";
        if (preview) requireAdmin(request, config);
        const survey = decodeSurvey(db.prepare("SELECT * FROM surveys WHERE slug = ?").get(slug));
        if (!survey || (!preview && survey.status !== "published")) throw new HttpError(404, "问卷不存在或尚未发布");
        return json(response, 200, { survey: { ...survey.definition, id: survey.id, slug: survey.slug, version: survey.version, title: survey.title, description: survey.description, updatedAt: survey.updated_at } });
      }
      if (path === "/api/submit-response") {
        allow(request, ["POST"]);
        submissions.check(ip);
        const { response: input } = await readBody(request);
        if (!input?.surveyId || typeof input.surveyId !== "string") throw new HttpError(400, "答卷缺少问卷 ID");
        const preview = input.metadata?.isPreview === true || Boolean(input.metadata?.previewToken);
        if (preview) requireAdmin(request, config);
        const survey = decodeSurvey(db.prepare("SELECT * FROM surveys WHERE id = ?").get(input.surveyId));
        if (!survey || (!preview && survey.status !== "published")) throw new HttpError(404, "问卷不存在或不可提交");
        const keyHeader = request.headers["idempotency-key"];
        if (keyHeader && !/^[a-zA-Z0-9._-]{16,128}$/.test(keyHeader)) throw new HttpError(400, "提交标识格式不正确");
        const key = keyHeader ? `${survey.id}:${preview ? "preview" : "public"}:${keyHeader}` : null;
        if (key) {
          const existing = db.prepare("SELECT id, response FROM survey_responses WHERE submission_key = ?").get(key);
          if (existing) {
            const previous = JSON.parse(existing.response);
            if (JSON.stringify(previous.answers) !== JSON.stringify(input.answers) || previous.surveyVersion !== Number(input.surveyVersion)) throw new HttpError(409, "本次答卷已经提交，请勿重复修改提交");
            return json(response, 200, { id: existing.id, duplicate: true });
          }
        }
        const payload = validateResponse(input, survey, preview);
        const id = randomUUID();
        db.prepare(`INSERT INTO survey_responses (id, survey_id, survey_version, respondent_id, submitted_at, response, created_at, submission_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, survey.id, survey.version, payload.respondent?.id || null, payload.submittedAt, JSON.stringify(payload), new Date().toISOString(), key);
        submissions.hit(ip);
        return json(response, 200, { id });
      }
      throw new HttpError(404, "接口不存在");
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error("Request failed:", error.code || error.name);
      return json(response, status, { error: status === 500 ? "服务器暂时不可用，请稍后再试" : error.message, ...(error.details ? { details: error.details } : {}) }, status === 429 ? { "Retry-After": "900" } : {});
    }
  };
}
