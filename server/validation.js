import { HttpError } from "./auth.js";
import { validateDefinition } from "../src/lib/definition.js";
import { computeSurveyValues, getAllQuestions, getVisiblePages, pruneHiddenAnswers, validatePage } from "../src/lib/surveyEngine.js";
import { removePreviewCredential } from "./database.js";

export function validateSurvey(input) {
  if (!input || typeof input !== "object") throw new HttpError(400, "缺少问卷数据");
  if (typeof input.slug !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(input.slug)) {
    throw new HttpError(400, "链接标识请使用字母、数字、下划线或短横线（最多 128 位）");
  }
  try { validateDefinition(input.definition); } catch (error) { throw new HttpError(400, error.message); }
  if (input.status === "published" && !input.definition.pages.some((page) => page.questions.length)) throw new HttpError(400, "至少添加一道题目后才能发布");
  return {
    slug: input.slug,
    status: input.status === "published" ? "published" : "unpublished",
    title: input.definition.title.trim(),
    description: String(input.definition.description ?? ""),
    version: Number(input.definition.version || 1),
    definition: input.definition
  };
}

export function validateResponse(input, survey, isPreview) {
  if (!input || typeof input !== "object" || !Array.isArray(input.answers) || input.answers.length > 1000) throw new HttpError(400, "答卷格式不正确");
  if (Number(input.surveyVersion) !== survey.version) throw new HttpError(409, "问卷已更新，请刷新页面后重新填写");
  const questions = getAllQuestions(survey.definition);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const answers = Object.create(null);
  for (const answer of input.answers) {
    const question = questionMap.get(answer?.questionId);
    if (!question || Object.hasOwn(answers, question.id)) throw new HttpError(400, "答卷包含未知或重复题目");
    if (answer.type && answer.type !== question.type) throw new HttpError(400, "答卷题型不匹配");
    if (answer.textValue != null && (typeof answer.textValue !== "object" || Array.isArray(answer.textValue) ||
      Object.values(answer.textValue).some((value) => typeof value !== "string" || value.length > 10000))) throw new HttpError(400, "补充答案格式不正确");
    if (answer.value !== undefined && answer.value !== null && answer.value !== "") {
      let valid = true;
      if (question.type === "singleChoice") valid = question.options.some((option) => option.value === answer.value);
      if (question.type === "multipleChoice") valid = Array.isArray(answer.value) && new Set(answer.value).size === answer.value.length && answer.value.every((value) => question.options.some((option) => option.value === value));
      if (question.type === "rating") valid = Number.isInteger(answer.value) && answer.value >= question.scale.min && answer.value <= question.scale.max;
      if (["text", "textarea"].includes(question.type)) valid = typeof answer.value === "string" && answer.value.length <= 10000;
      if (question.type === "dateParts") valid = typeof answer.value === "object" && !Array.isArray(answer.value) && Object.values(answer.value).every((value) => ["string", "number"].includes(typeof value) && String(value).length <= 4);
      if (!valid) throw new HttpError(400, "答案超出题目允许的范围");
    }
    answers[question.id] = answer;
  }
  const visibleAnswers = pruneHiddenAnswers(survey.definition, answers);
  const pages = getVisiblePages(survey.definition, visibleAnswers);
  const errors = Object.assign({}, ...pages.map((page) => validatePage(page, visibleAnswers)));
  if (Object.keys(errors).length) throw new HttpError(400, "请检查必填项与答案格式", errors);
  if (!pages.length) throw new HttpError(400, "当前问卷没有可填写的问题");
  const visibleIds = new Set(pages.flatMap((page) => page.questions.map((question) => question.id)));
  const response = removePreviewCredential(input);
  const submittedAt = new Date().toISOString();
  const startTime = Date.parse(input.startedAt);
  if (!Number.isFinite(startTime) || startTime > Date.now() + 60000) throw new HttpError(400, "开始时间无效，请刷新页面后重试");
  if (input.respondent != null && (typeof input.respondent !== "object" || Array.isArray(input.respondent))) throw new HttpError(400, "提交者格式不正确");
  if (input.metadata != null && (typeof input.metadata !== "object" || Array.isArray(input.metadata))) throw new HttpError(400, "答卷元信息格式不正确");
  if (input.respondent?.id != null && (typeof input.respondent.id !== "string" || input.respondent.id.length > 128)) throw new HttpError(400, "提交者 ID 格式不正确");
  return {
    ...response,
    schema: "custom-survey-response.v1",
    surveyId: survey.id,
    surveyVersion: survey.version,
    submittedAt,
    durationMs: Math.max(0, Date.now() - startTime),
    status: "completed",
    answers: input.answers.filter((answer) => visibleIds.has(answer.questionId)),
    computedValues: computeSurveyValues(survey.definition, visibleAnswers),
    skipped: questions.filter((question) => !visibleIds.has(question.id)).map((question) => ({ questionId: question.id, reason: "condition_not_met", condition: question.visibleIf ?? null })),
    metadata: { ...(response.metadata || {}), isPreview, storage: "server-sqlite" }
  };
}
