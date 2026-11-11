import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export function normalizeIp(value) {
  if (typeof value !== "string" || value.includes("%")) return null;
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  const address = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(address);
  if (!mapped) return address;
  const high = parseInt(mapped[1], 16);
  const low = parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

export function validateProxyToken(value) {
  if (typeof value !== "string" || (value && (value.length < 32 || value.length > 128 || /[^A-Za-z0-9_-]/.test(value)))) {
    throw new Error("AUTH_PROXY_TOKEN 必须是 32–128 个 URL 安全字符");
  }
  return value;
}

export function clientIp(request, proxyToken = "") {
  const peer = normalizeIp(request.socket.remoteAddress);
  const supplied = request.headers["x-auth-proxy-token"];
  // A loopback connection alone is not proof: SSH tunnels can also reach it.
  if (typeof proxyToken === "string" && proxyToken.length >= 32 && proxyToken.length <= 128 && (peer === "::1" || peer?.startsWith("127.")) && typeof supplied === "string") {
    const actual = Buffer.from(supplied);
    const expected = Buffer.from(proxyToken);
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      const forwarded = normalizeIp(request.headers["x-real-ip"]);
      if (forwarded) return forwarded;
    }
  }
  // X-Forwarded-For is deliberately never used.
  return peer;
}

export function logAuthFailure(ip, stream = process.stderr) {
  const address = normalizeIp(ip);
  if (!address) return;
  // Journal supplies the timestamp and unit; credentials never enter the record.
  stream.write(JSON.stringify({ event: "auth_failure", app: "survey", ip: address, method: "password", reason: "invalid_credentials" }) + "\n");
}
