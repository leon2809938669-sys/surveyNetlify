import { getSupabase, handleOptions, json, requireAdmin } from "./_shared.js";

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  try {
    requireAdmin(event);
    const surveyId = event.queryStringParameters?.surveyId;
    if (!surveyId) return json(400, { error: "缺少 surveyId" });

    const supabase = getSupabase();
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
