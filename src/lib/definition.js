const types = new Set(["text", "textarea", "dateParts", "singleChoice", "multipleChoice", "rating"]);
const operators = new Set(["answered", "notAnswered", "equals", "notEquals", "includes", "notIncludes", "gt", "gte", "lt", "lte"]);
const reserved = new Set(["__proto__", "prototype", "constructor"]);

export function validateDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new Error("问卷定义必须是一个对象");
  if (typeof definition.title !== "string" || !definition.title.trim()) throw new Error("请填写问卷标题");
  const version = Number(definition.version || 1);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("问卷版本必须为正整数");
  if (!Array.isArray(definition.pages) || !definition.pages.length || definition.pages.length > 100) throw new Error("问卷需要 1–100 个页面");
  const pageIds = new Set();
  const questionIds = new Set();
  const questions = [];
  function uniqueId(id, ids, label) {
    if (typeof id !== "string" || !id.trim() || id.length > 128 || reserved.has(id) || ids.has(id)) throw new Error(`${label} ID 不能为空、重复或使用保留字`);
    ids.add(id);
  }
  for (const page of definition.pages) {
    if (!page || typeof page !== "object") throw new Error("页面格式不正确");
    uniqueId(page.id, pageIds, "页面");
    if (!Array.isArray(page.questions)) throw new Error("每个页面需要 questions 数组");
    for (const question of page.questions) {
      if (!question || typeof question !== "object") throw new Error("题目格式不正确");
      uniqueId(question.id, questionIds, "题目");
      if (!types.has(question.type)) throw new Error(`不支持的题型：${question.type}`);
      if (typeof question.title !== "string" || !question.title.trim()) throw new Error("请填写题目标题");
      if (["singleChoice", "multipleChoice"].includes(question.type)) {
        if (!Array.isArray(question.options) || !question.options.length || question.options.length > 200) throw new Error("选择题需要 1–200 个选项");
        const values = new Set();
        for (const option of question.options) {
          if (!option || !["string", "number"].includes(typeof option.value) || option.value === "" || values.has(option.value) || typeof option.label !== "string") throw new Error("选项值不能为空或重复，显示文字必须为字符串");
          values.add(option.value);
        }
      }
      if (question.type === "rating") {
        const { min, max } = question.scale || {};
        if (!Number.isInteger(min) || !Number.isInteger(max) || max < min || max - min > 20) throw new Error("评分范围无效（最多 21 档）");
      }
      if (question.validation?.pattern) {
        if (typeof question.validation.pattern !== "string" || question.validation.pattern.length > 256) throw new Error("校验正则过长");
        try { new RegExp(question.validation.pattern); } catch { throw new Error("题目校验正则不正确"); }
      }
      questions.push(question);
    }
  }
  if (questions.length > 1000) throw new Error("题目不能超过 1000 道");
  function validateCondition(condition, depth = 0) {
    if (!condition) return;
    if (typeof condition !== "object" || depth > 10) throw new Error("显示条件格式不正确或嵌套过深");
    if (condition.all || condition.any) {
      const conditions = condition.all || condition.any;
      if (!Array.isArray(conditions) || conditions.length > 100) throw new Error("组合条件格式不正确");
      conditions.forEach((item) => validateCondition(item, depth + 1));
    } else if (!questionIds.has(condition.questionId) || !operators.has(condition.operator)) {
      throw new Error("显示条件引用了不存在的题目或运算符");
    }
  }
  questions.forEach((question) => validateCondition(question.visibleIf));
  return definition;
}
