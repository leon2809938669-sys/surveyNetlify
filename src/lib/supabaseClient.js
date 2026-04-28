import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const responsesTable = import.meta.env.VITE_SURVEY_RESPONSES_TABLE || "survey_responses";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export async function submitSurveyResponse(response) {
  if (!supabase) {
    const existing = JSON.parse(localStorage.getItem("survey_responses") || "[]");
    localStorage.setItem("survey_responses", JSON.stringify([...existing, response]));
    return { mode: "local", data: response };
  }

  const row = {
    survey_id: response.surveyId,
    survey_version: response.surveyVersion,
    respondent_id: response.respondent.id,
    submitted_at: response.submittedAt,
    response
  };

  const { data, error } = await supabase.from(responsesTable).insert(row).select().single();
  if (error) throw error;
  return { mode: "supabase", data };
}
