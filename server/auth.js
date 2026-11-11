import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function matchesPassword(input, expected) {
  if (typeof input !== "string" || input.length > 512) return false;
  const hash = (value) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(input), hash(expected));
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createSession(config) {
  const encoded = Buffer.from(JSON.stringify({
    role: "admin", exp: Math.floor(Date.now() / 1000) + config.sessionSeconds,
    nonce: randomBytes(16).toString("hex")
  })).toString("base64url");
  return `${encoded}.${sign(encoded, config.secret)}`;
}

export function isAdmin(request, config) {
  const token = (request.headers.cookie || "").split(";").map((part) => part.trim())
    .find((part) => part.startsWith("survey_session="))?.slice("survey_session=".length);
  if (!token || token.length > 1024) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [encoded, signature] = parts;
  const expected = sign(encoded, config.secret);
  const signatureBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (signatureBytes.length !== expectedBytes.length || !timingSafeEqual(signatureBytes, expectedBytes)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return payload.role === "admin" && Number.isFinite(payload.exp) && payload.exp > Date.now() / 1000;
  } catch { return false; }
}

export function requireAdmin(request, config) {
  if (!isAdmin(request, config)) throw new HttpError(401, "登录已失效，请重新登录");
}

export function sessionCookie(token, config) {
  return `survey_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? config.sessionSeconds : 0}${config.cookieSecure ? "; Secure" : ""}`;
}

export function checkSameOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "不允许跨站请求");
  if (!request.headers.origin) return;
  try {
    if (new URL(request.headers.origin).host === request.headers.host) return;
  } catch { /* Invalid Origin is not trusted. */ }
  throw new HttpError(403, "不允许跨站请求");
}

export class RateLimiter {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.entries = new Map();
  }
  check(key) {
    const entry = this.entries.get(key);
    if (entry && entry.until > Date.now() && entry.count >= this.limit) {
      throw new HttpError(429, "操作过于频繁，请稍后再试");
    }
  }
  hit(key) {
    const now = Date.now();
    if (this.entries.size > 10000) {
      for (const [id, entry] of this.entries) if (entry.until <= now) this.entries.delete(id);
      if (this.entries.size > 10000) throw new HttpError(429, "请求过于频繁，请稍后再试");
    }
    const entry = this.entries.get(key);
    this.entries.set(key, !entry || entry.until <= now ? { count: 1, until: now + this.windowMs } : { ...entry, count: entry.count + 1 });
  }
  clear(key) { this.entries.delete(key); }
}
