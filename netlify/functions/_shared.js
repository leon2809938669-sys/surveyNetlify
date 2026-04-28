import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS"
};

export function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  };
}

export function handleOptions(event) {
  return event.httpMethod === "OPTIONS" ? json(200, { ok: true }) : null;
}

export function parseBody(event) {
  if (!event.body) return {};
  return JSON.parse(event.body);
}

export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Supabase 环境变量未配置");
  }
  return createClient(url, key, {
    auth: { persistSession: false }
  });
}

function getAuthSecret() {
  const secret = process.env.NETLIFY_ADMIN_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) {
    throw new Error("管理密码环境变量未配置");
  }
  return secret;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function sign(value) {
  return crypto.createHmac("sha256", getAuthSecret()).update(value).digest("base64url");
}

export function createAdminToken() {
  const payload = {
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function requireAdmin(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  const [encoded, signature] = token.split(".");

  if (!encoded || !signature || sign(encoded) !== signature) {
    throw new Error("未登录或登录已失效");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (payload.role !== "admin" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("未登录或登录已失效");
  }

  return payload;
}

export function normalizeSurvey(row) {
  return {
    id: row.id,
    slug: row.slug,
    status: row.status === "published" ? "published" : "unpublished",
    title: row.title,
    description: row.description,
    version: row.version,
    definition: row.definition,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
