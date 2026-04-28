import React from "react";
import { Plus, Trash2 } from "lucide-react";

const QUESTION_TYPES = [
  { value: "text", label: "短文本" },
  { value: "textarea", label: "长文本" },
  { value: "dateParts", label: "年月日" },
  { value: "singleChoice", label: "单选" },
  { value: "multipleChoice", label: "多选" },
  { value: "rating", label: "评分" }
];

const CONDITION_OPERATORS = [
  { value: "", label: "不设置" },
  { value: "answered", label: "已填写" },
  { value: "notAnswered", label: "未填写" },
  { value: "equals", label: "等于" },
  { value: "notEquals", label: "不等于" },
  { value: "includes", label: "包含" },
  { value: "notIncludes", label: "不包含" },
  { value: "gt", label: "大于" },
  { value: "gte", label: "大于等于" },
  { value: "lt", label: "小于" },
  { value: "lte", label: "小于等于" }
];

export default function VisualSurveyEditor({ definition, onChange }) {
  function updateRoot(patch) {
    onChange({ ...definition, ...patch });
  }

  function updatePage(pageIndex, patch) {
    const pages = definition.pages.map((page, index) => index === pageIndex ? { ...page, ...patch } : page);
    onChange({ ...definition, pages });
  }

  function addPage() {
    const pages = definition.pages || [];
    const pageId = createSequentialId("page", pages.map((page) => page.id));
    onChange({
      ...definition,
      pages: [
        ...pages,
        { id: pageId, title: `第 ${pages.length + 1} 页`, questions: [] }
      ]
    });
  }

  function removePage(pageIndex) {
    const pages = definition.pages.filter((_, index) => index !== pageIndex);
    onChange({ ...definition, pages });
  }

  function updateQuestion(pageIndex, questionIndex, nextQuestion) {
    const pages = definition.pages.map((page, index) => {
      if (index !== pageIndex) return page;
      const questions = page.questions.map((question, qIndex) => qIndex === questionIndex ? nextQuestion : question);
      return { ...page, questions };
    });
    onChange({ ...definition, pages });
  }

  function addQuestion(pageIndex) {
    const pages = definition.pages.map((page, index) => {
      if (index !== pageIndex) return page;
      const existingIds = (page.questions || []).map((question) => question.id);
      return {
        ...page,
        questions: [
          ...(page.questions || []),
          {
            id: createSequentialId("question", existingIds),
            type: "text",
            title: "新题目",
            required: false
          }
        ]
      };
    });
    onChange({ ...definition, pages });
  }

  function removeQuestion(pageIndex, questionIndex) {
    const pages = definition.pages.map((page, index) => {
      if (index !== pageIndex) return page;
      return { ...page, questions: page.questions.filter((_, qIndex) => qIndex !== questionIndex) };
    });
    onChange({ ...definition, pages });
  }

  return (
    <div className="visual-editor">
      <section className="visual-editor-block">
        <h3>问卷信息</h3>
        <div className="visual-grid two">
          <Field label="问卷标题">
            <input className="text-input" value={definition.title || ""} onChange={(event) => updateRoot({ title: event.target.value })} />
          </Field>
          <Field label="问卷版本">
            <input
              className="text-input"
              inputMode="numeric"
              value={definition.version || 1}
              onChange={(event) => updateRoot({ version: Number(event.target.value) || 1 })}
            />
          </Field>
        </div>
        <Field label="说明文字">
          <textarea className="text-area compact" value={definition.description || ""} onChange={(event) => updateRoot({ description: event.target.value })} />
        </Field>
        <div className="visual-grid two">
          <Field label="提交按钮文字">
            <input className="text-input" value={definition.submitButtonText || ""} onChange={(event) => updateRoot({ submitButtonText: event.target.value })} />
          </Field>
          <Field label="完成页标题">
            <input className="text-input" value={definition.completionTitle || ""} onChange={(event) => updateRoot({ completionTitle: event.target.value })} />
          </Field>
        </div>
        <Field label="完成页说明">
          <input className="text-input" value={definition.completionMessage || ""} onChange={(event) => updateRoot({ completionMessage: event.target.value })} />
        </Field>
      </section>

      <div className="visual-section-title">
        <h3>页面与题目</h3>
        <button className="secondary-button" type="button" onClick={addPage}>
          <Plus size={18} />
          添加页面
        </button>
      </div>

      {(definition.pages || []).map((page, pageIndex) => (
        <section className="visual-editor-block page-editor" key={pageIndex}>
          <div className="page-editor-header">
            <div className="visual-grid two">
              <Field label="页面 ID">
                <input className="text-input" value={page.id || ""} onChange={(event) => updatePage(pageIndex, { id: event.target.value })} />
              </Field>
              <Field label="页面标题">
                <input className="text-input" value={page.title || ""} onChange={(event) => updatePage(pageIndex, { title: event.target.value })} />
              </Field>
            </div>
            <button className="secondary-button danger" type="button" onClick={() => removePage(pageIndex)} disabled={(definition.pages || []).length <= 1}>
              <Trash2 size={18} />
              删除页面
            </button>
          </div>

          <div className="question-editor-list">
            {(page.questions || []).map((question, questionIndex) => (
              <QuestionEditor
                key={questionIndex}
                definition={definition}
                question={question}
                onChange={(nextQuestion) => updateQuestion(pageIndex, questionIndex, nextQuestion)}
                onRemove={() => removeQuestion(pageIndex, questionIndex)}
              />
            ))}
          </div>

          <button className="secondary-button" type="button" onClick={() => addQuestion(pageIndex)}>
            <Plus size={18} />
            添加题目
          </button>
        </section>
      ))}
    </div>
  );
}

function QuestionEditor({ definition, question, onChange, onRemove }) {
  const needsOptions = question.type === "singleChoice" || question.type === "multipleChoice";
  const allQuestions = (definition.pages || []).flatMap((page) => page.questions || []);

  function update(patch) {
    onChange({ ...question, ...patch });
  }

  function updateType(type) {
    const nextQuestion = { ...question, type };
    if ((type === "singleChoice" || type === "multipleChoice") && !nextQuestion.options) {
      nextQuestion.options = [
        { value: "option_1", label: "选项 1" },
        { value: "option_2", label: "选项 2" }
      ];
    }
    if (type === "rating" && !nextQuestion.scale) {
      nextQuestion.scale = { min: 1, max: 5, minLabel: "低", maxLabel: "高" };
    }
    onChange(nextQuestion);
  }

  return (
    <article className="question-editor">
      <div className="question-editor-header">
        <strong>{question.title || "未命名题目"}</strong>
        <button className="icon-button danger" type="button" onClick={onRemove} aria-label="删除题目">
          <Trash2 size={16} />
        </button>
      </div>

      <div className="visual-grid three">
        <Field label="题目 ID">
          <input className="text-input" value={question.id || ""} onChange={(event) => update({ id: event.target.value })} />
        </Field>
        <Field label="题型">
          <select className="text-input" value={question.type || "text"} onChange={(event) => updateType(event.target.value)}>
            {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </Field>
        <label className="checkbox-field">
          <input type="checkbox" checked={Boolean(question.required)} onChange={(event) => update({ required: event.target.checked })} />
          必填
        </label>
      </div>

      <Field label="题目标题">
        <textarea className="text-area compact" value={question.title || ""} onChange={(event) => update({ title: event.target.value })} />
      </Field>

      {(question.type === "text" || question.type === "textarea") && (
        <Field label="占位提示">
          <input className="text-input" value={question.placeholder || ""} onChange={(event) => update({ placeholder: event.target.value })} />
        </Field>
      )}

      {question.type === "rating" && <RatingEditor question={question} onChange={onChange} />}

      {needsOptions && <OptionsEditor question={question} onChange={onChange} />}

      <ConditionEditor question={question} questions={allQuestions} onChange={onChange} />
    </article>
  );
}

function OptionsEditor({ question, onChange }) {
  const options = question.options || [];

  function updateOption(optionIndex, patch) {
    const nextOptions = options.map((option, index) => index === optionIndex ? { ...option, ...patch } : option);
    onChange({ ...question, options: nextOptions });
  }

  function addOption() {
    onChange({
      ...question,
      options: [
        ...options,
        { value: `option_${options.length + 1}`, label: `选项 ${options.length + 1}` }
      ]
    });
  }

  function removeOption(optionIndex) {
    onChange({ ...question, options: options.filter((_, index) => index !== optionIndex) });
  }

  return (
    <div className="nested-editor">
      <div className="nested-editor-title">
        <span>选项</span>
        <button className="secondary-button small" type="button" onClick={addOption}>
          <Plus size={16} />
          添加选项
        </button>
      </div>
      {options.map((option, optionIndex) => (
        <div className="option-editor-row" key={`${option.value}-${optionIndex}`}>
          <input className="text-input" value={option.value ?? ""} placeholder="值" onChange={(event) => updateOption(optionIndex, { value: event.target.value })} />
          <input className="text-input" value={option.label ?? ""} placeholder="显示文字" onChange={(event) => updateOption(optionIndex, { label: event.target.value })} />
          <label className="checkbox-field compact">
            <input type="checkbox" checked={Boolean(option.allowText)} onChange={(event) => updateOption(optionIndex, { allowText: event.target.checked })} />
            可填写
          </label>
          <button className="icon-button danger" type="button" onClick={() => removeOption(optionIndex)} aria-label="删除选项">
            <Trash2 size={16} />
          </button>
          {option.allowText && (
            <input
              className="text-input option-text-placeholder"
              value={option.textPlaceholder || ""}
              placeholder="补充填写提示"
              onChange={(event) => updateOption(optionIndex, { textPlaceholder: event.target.value })}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RatingEditor({ question, onChange }) {
  const scale = question.scale || {};

  function updateScale(patch) {
    onChange({ ...question, scale: { ...scale, ...patch } });
  }

  return (
    <div className="nested-editor">
      <div className="nested-editor-title">
        <span>评分设置</span>
      </div>
      <div className="visual-grid four">
        <Field label="最小值">
          <input className="text-input" inputMode="numeric" value={scale.min ?? 1} onChange={(event) => updateScale({ min: Number(event.target.value) || 1 })} />
        </Field>
        <Field label="最大值">
          <input className="text-input" inputMode="numeric" value={scale.max ?? 5} onChange={(event) => updateScale({ max: Number(event.target.value) || 5 })} />
        </Field>
        <Field label="低分说明">
          <input className="text-input" value={scale.minLabel || ""} onChange={(event) => updateScale({ minLabel: event.target.value })} />
        </Field>
        <Field label="高分说明">
          <input className="text-input" value={scale.maxLabel || ""} onChange={(event) => updateScale({ maxLabel: event.target.value })} />
        </Field>
      </div>
    </div>
  );
}

function ConditionEditor({ question, questions, onChange }) {
  const condition = question.visibleIf || {};
  const simpleCondition = !condition.all && !condition.any;

  if (!simpleCondition) {
    return (
      <div className="nested-editor">
        <div className="nested-editor-title">
          <span>显示条件</span>
        </div>
        <p className="muted-text">当前题目使用了组合条件，请在 JSON 模式中编辑。</p>
      </div>
    );
  }

  function updateCondition(patch) {
    const nextCondition = { ...condition, ...patch };
    if (!nextCondition.operator) {
      const { visibleIf, ...rest } = question;
      onChange(rest);
      return;
    }
    onChange({ ...question, visibleIf: nextCondition });
  }

  return (
    <div className="nested-editor">
      <div className="nested-editor-title">
        <span>显示条件</span>
      </div>
      <div className="visual-grid three">
        <Field label="依赖题目">
          <select
            className="text-input"
            value={condition.questionId || ""}
            onChange={(event) => updateCondition({ questionId: event.target.value })}
          >
            <option value="">选择题目</option>
            {questions.filter((item) => item.id !== question.id).map((item) => (
              <option key={item.id} value={item.id}>{item.title || item.id}</option>
            ))}
          </select>
        </Field>
        <Field label="条件">
          <select
            className="text-input"
            value={condition.operator || ""}
            onChange={(event) => updateCondition({ operator: event.target.value })}
          >
            {CONDITION_OPERATORS.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}
          </select>
        </Field>
        <Field label="比较值">
          <input
            className="text-input"
            value={condition.value ?? ""}
            disabled={condition.operator === "answered" || condition.operator === "notAnswered" || !condition.operator}
            onChange={(event) => updateCondition({ value: coerceConditionValue(event.target.value) })}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="visual-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function coerceConditionValue(value) {
  if (value.trim() === "") return "";
  const numeric = Number(value);
  return Number.isNaN(numeric) ? value : numeric;
}

function createSequentialId(prefix, existingIds) {
  const existing = new Set(existingIds.filter(Boolean));
  let index = existing.size + 1;
  let id = `${prefix}${index}`;
  while (existing.has(id)) {
    index += 1;
    id = `${prefix}${index}`;
  }
  return id;
}
