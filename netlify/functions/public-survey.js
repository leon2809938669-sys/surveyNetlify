import { getSupabase, handleOptions, json } from "./_shared.js";

export async function handler(event) {
  const options = handleOptions(event);
  if (options) return options;

  try {
    const slug = event.queryStringParameters?.slug;
    if (!slug) return json(400, { error: "缺少问卷 slug" });

    const supabase = getSupabase();
    const { data, error } = await supabase
      .from("surveys")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .single();

    if (error || !data) {
      return json(404, { error: "问卷不存在或尚未发布" });
    }

    return json(200, {
      survey: {
        ...data.definition,
        id: data.id,
        slug: data.slug,
        version: data.version,
        title: data.title || data.definition.title,
        description: data.description || data.definition.description
      }
    });
  } catch (error) {
    return json(500, { error: error.message });
  }
}
