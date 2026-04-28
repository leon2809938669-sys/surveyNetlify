import { createAdminToken, handleOptions, json, parseBody } from "./_shared.js";

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { password } = parseBody(event);
    if (!process.env.ADMIN_PASSWORD) {
      return json(500, { error: "ADMIN_PASSWORD 未配置" });
    }
    if (password !== process.env.ADMIN_PASSWORD) {
      return json(401, { error: "密码不正确" });
    }
    return json(200, { token: createAdminToken() });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
