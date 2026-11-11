import assert from "node:assert/strict";
import { test } from "node:test";
import { clientIp, logAuthFailure, normalizeIp, validateProxyToken } from "../server/auth-logging.js";

const token = "test-proxy-token-" + "x".repeat(32);
const request = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, headers });

test("client IPs are numeric, canonical, and cannot inject log records", () => {
  for (const [raw, expected] of [
    ["203.0.113.8", "203.0.113.8"], ["2001:DB8:0:0::8", "2001:db8::8"],
    ["::ffff:203.0.113.8", "203.0.113.8"], ["::ffff:cb00:7108", "203.0.113.8"],
    ["localhost", null], ["fe80::1%eth0", null], ["203.0.113.8, 203.0.113.9", null],
    ["203.0.113.8\nforged", null], [" 203.0.113.8", null], [undefined, null]
  ]) assert.equal(normalizeIp(raw), expected, String(raw));
});

test("forwarded IPs require an authenticated loopback proxy, not just local reachability", () => {
  const headers = { "x-real-ip": "203.0.113.8", "x-forwarded-for": "203.0.113.9" };
  assert.equal(clientIp(request("127.0.0.1", headers), token), "127.0.0.1");
  headers["x-auth-proxy-token"] = token;
  assert.equal(clientIp(request("::ffff:127.0.0.1", headers), token), "203.0.113.8");
  assert.equal(clientIp(request("::1", headers), token), "203.0.113.8");
  assert.equal(clientIp(request("198.51.100.8", headers), token), "198.51.100.8");
  assert.equal(clientIp(request("127.0.0.1", headers)), "127.0.0.1");
  for (const supplied of ["wrong", "测".repeat(token.length), `${token}, ${token}`, [token, token]]) {
    assert.equal(clientIp(request("127.0.0.1", { ...headers, "x-auth-proxy-token": supplied }), token), "127.0.0.1");
  }
});

test("IP chains, duplicate headers and X-Forwarded-For are never accepted as client addresses", () => {
  for (const ip of [undefined, "", "localhost", "203.0.113.8, 203.0.113.9", ["203.0.113.8", "203.0.113.9"]]) {
    assert.equal(clientIp(request("127.0.0.1", { "x-auth-proxy-token": token, "x-real-ip": ip, "x-forwarded-for": "203.0.113.8" }), token), "127.0.0.1");
  }
});

test("proxy tokens must be private URL-safe values of sufficient length", () => {
  assert.equal(validateProxyToken(""), "");
  assert.equal(validateProxyToken(token), token);
  for (const invalid of ["short", "x".repeat(129), "x".repeat(32) + "\n", "测".repeat(32), null]) {
    assert.throws(() => validateProxyToken(invalid), /AUTH_PROXY_TOKEN/);
  }
});

test("failure event schema is one JSON line without credentials or arbitrary strings", () => {
  const lines = [];
  const stream = { write: (line) => lines.push(line) };
  logAuthFailure("::ffff:203.0.113.8", stream);
  logAuthFailure('203.0.113.8"}\n{"event":"auth_failure"', stream);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].split("\n").length, 2);
  assert.deepEqual(JSON.parse(lines[0]), { event: "auth_failure", app: "survey", ip: "203.0.113.8", method: "password", reason: "invalid_credentials" });
});
