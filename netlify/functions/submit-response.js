import { getSupabase, handleOptions, json, parseBody } from "./_shared.js";

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  try {
    const { response } = parseBody(event);
    if (!response?.surveyId) {
      return json(400, { error: "答卷缺少 surveyId" });
    }

    const supabase = getSupabase();
    const { data: survey, error: surveyError } = await supabase
      .from("surveys")
      .select("id,status")
      .eq("id", response.surveyId)
      .eq("status", "published")
      .single();

    if (surveyError || !survey) {
      return json(404, { error: "问卷不存在或不可提交" });
    }

    const row = {
      survey_id: response.surveyId,
      survey_version: response.surveyVersion,
      respondent_id: response.respondent?.id || null,
      submitted_at: response.submittedAt,
      response
    };

    const { data, error } = await supabase
      .from("survey_responses")
      .insert(row)
      .select("id")
      .single();

    if (error) throw error;
    return json(200, { id: data.id });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
