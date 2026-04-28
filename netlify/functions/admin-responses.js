import { getSupabase, handleOptions, json, parseBody, requireAdmin } from "./_shared.js";

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  try {
    requireAdmin(event);
    const surveyId = event.queryStringParameters?.surveyId;
    if (!surveyId) return json(400, { error: "缺少 surveyId" });

    const supabase = getSupabase();

    if (event.httpMethod === "DELETE") {
      const { ids = [], all = false } = parseBody(event);
      let query = supabase.from("survey_responses").delete().eq("survey_id", surveyId);

      if (!all) {
        if (!Array.isArray(ids) || ids.length === 0) {
          return json(400, { error: "缺少要删除的答卷 ID" });
        }
        query = query.in("id", ids);
      }

      const { error } = await query;
      if (error) throw error;
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "GET") {
      return json(405, { error: "Method not allowed" });
    }

    const { data, error } = await supabase
      .from("survey_responses")
      .select("*")
      .eq("survey_id", surveyId)
      .order("submitted_at", { ascending: false });

    if (error) throw error;
    return json(200, { responses: data || [] });
  } catch (error) {
    const status = error.message.includes("登录") ? 401 : 500;
    return json(status, { error: error.message });
  }
}
