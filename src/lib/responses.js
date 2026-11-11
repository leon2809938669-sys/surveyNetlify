export function buildQuestionMap(definition) {
  return new Map((definition?.pages || []).flatMap((page) => page.questions || []).map((question) => [question.id, question]));
}

export function formatAnswerValue(answer, question) {
  if (question?.type === "dateParts") {
    const value = answer.value;
    return value?.year && value?.month && value?.day ? `${value.year}-${String(Number(value.month)).padStart(2, "0")}-${String(Number(value.day)).padStart(2, "0")}` : "";
  }
  const labelMap = new Map((question?.options || []).map((option) => [option.value, option.label]));
  const label = (value) => labelMap.get(value) ?? value ?? "";
  return Array.isArray(answer.value) ? answer.value.map(label).join("，") : label(answer.value);
}

export function formatTextValue(textValue, question) {
  if (!textValue || typeof textValue !== "object") return "";
  const labels = new Map((question?.options || []).map((option) => [String(option.value), option.label]));
  return Object.entries(textValue).filter(([, value]) => String(value ?? "").trim())
    .map(([key, value]) => `${labels.get(key) ?? key}：${value}`).join("；");
}

export function flattenResponse(row, definition) {
  const questions = buildQuestionMap(definition);
  const titleCounts = new Map();
  for (const question of questions.values()) titleCounts.set(question.title, (titleCounts.get(question.title) || 0) + 1);
  const output = {
    "答卷ID": row.id, "问卷ID": row.survey_id, "问卷版本": row.survey_version,
    "提交者ID": row.respondent_id, "提交时间": row.submitted_at, "填写时长毫秒": row.response?.durationMs ?? "",
    "来源": row.response?.metadata?.isPreview ? "管理预览" : "公开填写"
  };
  for (const field of definition?.computedFields || []) {
    const computed = row.response?.computedValues?.[field.id];
    output[field.label || field.id] = computed?.displayValue ?? computed?.value ?? "";
  }
  for (const answer of row.response?.answers || []) {
    const question = questions.get(answer.questionId);
    const label = question?.title || answer.questionId;
    let column = titleCounts.get(label) > 1 || Object.hasOwn(output, label) ? `${label}（${answer.questionId}）` : label;
    while (Object.hasOwn(output, column)) column += "（答案）";
    output[column] = formatAnswerValue(answer, question);
    const text = formatTextValue(answer.textValue, question);
    if (text) output[`${column}（补充说明）`] = text;
  }
  return output;
}

export function formatTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", year: "numeric", hour12: false }) : "—";
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms)) return "—";
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}
