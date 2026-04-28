import { getSupabase, handleOptions, json, normalizeSurvey, parseBody, requireAdmin } from "./_shared.js";

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  try {
    requireAdmin(event);
    const supabase = getSupabase();

    if (event.httpMethod === "GET") {
      const { data, error } = await supabase
        .from("surveys")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const surveys = await Promise.all((data || []).map(async (row) => {
        const { count } = await supabase
          .from("survey_responses")
          .select("id", { count: "exact", head: true })
          .eq("survey_id", row.id);
        return { ...normalizeSurvey(row), responseCount: count || 0 };
      }));

      return json(200, { surveys });
    }

    if (event.httpMethod === "POST" || event.httpMethod === "PUT") {
      const { survey } = parseBody(event);
      const definition = survey.definition;
      const row = {
        slug: survey.slug,
        status: survey.status || "draft",
        title: definition.title || survey.title || survey.slug,
        description: definition.description || survey.description || "",
        version: Number(definition.version || survey.version || 1),
        definition
      };

      let query;
      if (event.httpMethod === "PUT" && survey.id) {
        query = supabase.from("surveys").update(row).eq("id", survey.id).select("*").single();
      } else {
        query = supabase.from("surveys").insert(row).select("*").single();
      }

      const { data, error } = await query;
      if (error) throw error;
      return json(200, { survey: normalizeSurvey(data) });
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters?.id;
      if (!id) return json(400, { error: "缺少 id" });
      const { error } = await supabase.from("surveys").delete().eq("id", id);
      if (error) throw error;
      return json(200, { ok: true });
    }

    return json(405, { error: "Method not allowed" });
  } catch (error) {
    const status = error.message.includes("登录") ? 401 : 500;
    return json(status, { error: error.message });
  }
}
