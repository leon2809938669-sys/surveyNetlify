import { getSupabase, handleOptions, json } from "./_shared.js";

export const config = {
  schedule: "@daily"
};

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  try {
    const supabase = getSupabase();
    const { error, count } = await supabase
      .from("surveys")
      .select("id", { count: "exact", head: true })
      .limit(1);

    if (error) throw error;

    return json(200, {
      ok: true,
      checkedAt: new Date().toISOString(),
      surveyCount: count ?? 0
    });
  } catch (error) {
    return json(500, { ok: false, error: error.message });
  }
}
