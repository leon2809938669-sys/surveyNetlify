import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateProxyToken } from "./auth-logging.js";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function loadEnvironment(file = process.env.ENV_FILE || resolve(projectRoot, ".env")) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export function getConfig() {
  const password = process.env.ADMIN_PASSWORD || "";
  const secret = process.env.AUTH_SECRET || "";
  if (!password || password.startsWith("replace-with-")) {
    throw new Error("请在服务端配置 ADMIN_PASSWORD");
  }
  if (secret.length < 32 || secret.startsWith("replace-with-")) {
    throw new Error("AUTH_SECRET 必须是至少 32 位的随机字符串");
  }
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 无效");
  return {
    password,
    secret,
    authProxyToken: validateProxyToken(process.env.AUTH_PROXY_TOKEN || ""),
    host: process.env.HOST || "127.0.0.1",
    port,
    cookieSecure: process.env.COOKIE_SECURE === "true",
    dbPath: resolve(process.env.SURVEY_DB_PATH || resolve(projectRoot, ".data/survey.sqlite")),
    distPath: resolve(projectRoot, "dist"),
    sessionSeconds: 60 * 60 * 12
  };
}
