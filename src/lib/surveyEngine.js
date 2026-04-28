export function getAllQuestions(survey) {
  return survey.pages.flatMap((page) =>
    page.questions.map((question) => ({ ...question, pageId: page.id }))
  );
}

export function isAnswered(question, value) {
  if (question.type === "multipleChoice") {
    return Array.isArray(value?.value) && value.value.length > 0;
  }
  if (question.type === "singleChoice") {
    return Boolean(value?.value);
  }
  if (question.type === "rating") {
    return value?.value !== undefined && value?.value !== null && value?.value !== "";
  }
  return typeof value?.value === "string" && value.value.trim().length > 0;
}

export function isConditionMet(condition, answers) {
  if (!condition) return true;

  if (condition.all) {
    return condition.all.every((item) => isConditionMet(item, answers));
  }

  if (condition.any) {
    return condition.any.some((item) => isConditionMet(item, answers));
  }

  const answer = answers[condition.questionId];
  const value = answer?.value;

  switch (condition.operator) {
    case "answered":
      return value !== undefined && value !== null && value !== "" && (!Array.isArray(value) || value.length > 0);
    case "notAnswered":
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    case "equals":
      return value === condition.value;
    case "notEquals":
      return value !== condition.value;
    case "includes":
      return Array.isArray(value) && value.includes(condition.value);
    case "notIncludes":
      return !Array.isArray(value) || !value.includes(condition.value);
    case "gt":
      return Number(value) > Number(condition.value);
    case "gte":
      return Number(value) >= Number(condition.value);
    case "lt":
      return Number(value) < Number(condition.value);
    case "lte":
      return Number(value) <= Number(condition.value);
    default:
      return false;
  }
}

export function getVisiblePages(survey, answers) {
  return survey.pages
    .map((page) => ({
      ...page,
      questions: page.questions.filter((question) => isConditionMet(question.visibleIf, answers))
    }))
    .filter((page) => page.questions.length > 0);
}

export function validateQuestion(question, answer) {
  if (question.required && !isAnswered(question, answer)) {
    return "这道题为必填";
  }

  if (!isAnswered(question, answer)) return "";

  if (question.type === "multipleChoice") {
    const selected = answer.value ?? [];
    const minSelected = question.validation?.minSelected;
    const maxSelected = question.validation?.maxSelected;

    if (minSelected && selected.length < minSelected) {
      return `至少选择 ${minSelected} 项`;
    }
    if (maxSelected && selected.length > maxSelected) {
      return `最多选择 ${maxSelected} 项`;
    }
  }

  if (question.validation?.pattern && typeof answer.value === "string") {
    const pattern = new RegExp(question.validation.pattern);
    if (!pattern.test(answer.value.trim())) {
      return question.validation.message || "格式不正确";
    }
  }

  const options = question.options ?? [];
  const selectedValues = Array.isArray(answer?.value) ? answer.value : [answer?.value];
  const optionRequiringText = options.find((option) => option.allowText && selectedValues.includes(option.value));

  if (optionRequiringText) {
    const textValue = answer.textValue?.[optionRequiringText.value] ?? "";
    if (!textValue.trim()) {
      return "请补充填写";
    }
  }

  return "";
}

export function validatePage(page, answers) {
  return page.questions.reduce((errors, question) => {
    const error = validateQuestion(question, answers[question.id]);
    if (error) errors[question.id] = error;
    return errors;
  }, {});
}

export function pruneHiddenAnswers(survey, answers) {
  const visibleIds = new Set(getVisiblePages(survey, answers).flatMap((page) => page.questions.map((question) => question.id)));
  return Object.fromEntries(Object.entries(answers).filter(([questionId]) => visibleIds.has(questionId)));
}

export function buildResponsePayload({ survey, answers, startedAt }) {
  const allQuestions = getAllQuestions(survey);
  const visibleQuestions = new Set(
    getVisiblePages(survey, answers).flatMap((page) => page.questions.map((question) => question.id))
  );

  const responseAnswers = allQuestions
    .filter((question) => visibleQuestions.has(question.id) && answers[question.id])
    .map((question) => ({
      questionId: question.id,
      type: question.type,
      value: answers[question.id].value ?? null,
      textValue: answers[question.id].textValue ?? null
    }));

  const skipped = allQuestions
    .filter((question) => !visibleQuestions.has(question.id))
    .map((question) => ({
      questionId: question.id,
      reason: "condition_not_met",
      condition: question.visibleIf ?? null
    }));

  const submittedAt = new Date().toISOString();
  const startTime = new Date(startedAt).getTime();

  return {
    schema: "custom-survey-response.v1",
    surveyId: survey.id,
    surveyVersion: survey.version,
    respondent: {
      id: crypto.randomUUID(),
      source: "public-link",
      userAgent: navigator.userAgent,
      locale: navigator.language
    },
    startedAt,
    submittedAt,
    durationMs: Number.isFinite(startTime) ? Date.now() - startTime : null,
    status: "completed",
    answers: responseAnswers,
    skipped,
    metadata: {
      appVersion: import.meta.env.VITE_APP_VERSION || "0.1.0",
      storage: "supabase-postgres"
    }
  };
}
