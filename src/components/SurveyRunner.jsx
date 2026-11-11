import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Loader2, RotateCcw, Send, ShieldCheck } from "lucide-react";
import {
  buildResponsePayload,
  computeSurveyValues,
  getVisiblePages,
  isAnswered,
  pruneHiddenAnswers,
  validatePage
} from "../lib/surveyEngine";

function readDraft(key) {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) || "null");
    if (draft && typeof draft.answers === "object" && draft.answers && !Array.isArray(draft.answers) &&
      Number.isInteger(draft.page) && draft.page >= 0 && Number.isFinite(Date.parse(draft.startedAt)) &&
      Date.parse(draft.savedAt) > Date.now() - 86400000) return draft;
  } catch { /* Draft storage is optional, not a requirement for submitting. */ }
  return null;
}

export default function SurveyRunner({ survey, onSubmit, isPreview = false }) {
  const draftKey = `survey-draft:${survey.id}:${survey.version}:${survey.updatedAt || ""}:${isPreview}`;
  const [draft] = useState(() => readDraft(draftKey));
  const [answers, setAnswers] = useState(() => draft ? pruneHiddenAnswers(survey, draft.answers) : {});
  const [currentPageIndex, setCurrentPageIndex] = useState(draft?.page || 0);
  const [errors, setErrors] = useState({});
  const [startedAt, setStartedAt] = useState(() => draft?.startedAt || new Date().toISOString());
  const [resumed, setResumed] = useState(Boolean(draft && Object.keys(draft.answers).length));
  const [submission, setSubmission] = useState({ status: "idle", message: "" });
  const respondentId = useRef(draft?.respondentId || crypto.randomUUID());
  const submitting = useRef(false);
  const completionHeading = useRef(null);

  useEffect(() => {
    if (submission.status === "submitted") return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ answers, page: currentPageIndex, startedAt, respondentId: respondentId.current, savedAt: new Date().toISOString() })); } catch { /* A full/disabled store must not block the form. */ }
  }, [answers, currentPageIndex, startedAt, draftKey, submission.status]);
  useEffect(() => { if (submission.status === "submitted") completionHeading.current?.focus(); }, [submission.status]);

  const visiblePages = useMemo(() => getVisiblePages(survey, answers), [survey, answers]);
  const boundedPageIndex = Math.min(currentPageIndex, Math.max(visiblePages.length - 1, 0));
  const currentPage = visiblePages[boundedPageIndex];
  const totalQuestions = visiblePages.reduce((sum, page) => sum + page.questions.length, 0);
  const answeredCount = visiblePages
    .flatMap((page) => page.questions)
    .filter((question) => isAnswered(question, answers[question.id])).length;
  const progress = totalQuestions ? Math.round((answeredCount / totalQuestions) * 100) : 0;
  const isLastPage = boundedPageIndex >= visiblePages.length - 1;
  const computedValues = useMemo(() => computeSurveyValues(survey, answers), [survey, answers]);
  const offset = visiblePages.slice(0, boundedPageIndex).reduce((sum, page) => sum + page.questions.length, 0);

  function focusError(pageErrors, pageIndex) {
    setErrors(pageErrors); setCurrentPageIndex(pageIndex);
    requestAnimationFrame(() => {
      const field = document.getElementById(`field-${Object.keys(pageErrors)[0]}`);
      field?.focus({ preventScroll: true }); field?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  function restart() {
    if (!window.confirm("确定清除本标签页的填写草稿并重新开始吗？")) return;
    respondentId.current = crypto.randomUUID(); setStartedAt(new Date().toISOString());
    setAnswers({}); setCurrentPageIndex(0); setErrors({}); setResumed(false); setSubmission({ status: "idle", message: "" });
  }

  function updateAnswer(question, nextAnswer) {
    setErrors((current) => ({ ...current, [question.id]: "" }));
    setAnswers((current) => pruneHiddenAnswers(survey, { ...current, [question.id]: nextAnswer }));
  }

  function goBack() {
    setCurrentPageIndex((index) => Math.max(0, index - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goNext() {
    const pageErrors = validatePage(currentPage, answers);
    if (Object.keys(pageErrors).length > 0) return focusError(pageErrors, boundedPageIndex);
    setErrors({});
    setCurrentPageIndex((index) => Math.min(visiblePages.length - 1, index + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    if (submitting.current) return;
    for (let index = 0; index < visiblePages.length; index += 1) {
      const pageErrors = validatePage(visiblePages[index], answers);
      if (Object.keys(pageErrors).length > 0) return focusError(pageErrors, index);
    }
    setErrors({}); submitting.current = true;

    setSubmission({ status: "submitting", message: "" });
    try {
      const payload = buildResponsePayload({ survey, answers, startedAt, respondentId: respondentId.current });
      await onSubmit(payload);
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional browser storage. */ }
      setSubmission({ status: "submitted", message: "提交成功" });
    } catch (error) {
      if (error.details) {
        const index = visiblePages.findIndex((page) => page.questions.some((question) => error.details[question.id]));
        if (index >= 0) focusError(error.details, index);
      }
      setSubmission({ status: "error", message: error.message || "提交失败，请稍后再试" });
    } finally { submitting.current = false; }
  }

  if (submission.status === "submitted") {
    return (
      <section className="complete-panel">
        <div className="complete-icon">
          <Check size={34} />
        </div>
        <p className="eyebrow">每一个声音，都很重要</p>
        <h1 ref={completionHeading} tabIndex={-1}>{survey.completionTitle || "你的声音，我们听见了。"}</h1>
        <p>{survey.completionMessage || "感谢你的认真填写。你的回答已安全保存，可以放心关闭这个页面。"}</p>
        {isPreview && <span className="source-badge preview">此份答卷已标记为管理预览</span>}
        <span className="completion-receipt"><CheckCircle2 size={16} />答卷已送达</span>
      </section>
    );
  }

  if (!currentPage) {
    return (
      <section className="survey-form">
        <p className="form-error">当前问卷没有可填写的问题。</p>
      </section>
    );
  }

  return (
    <>
      {resumed && <div className="draft-notice"><span><CheckCircle2 size={16} />已恢复本标签页的填写草稿</span><button className="text-button" type="button" onClick={restart}><RotateCcw size={14} />重新填写</button></div>}
      <section className="progress-block" aria-label="填写进度">
        <div className="progress-meta">
          <span>
            第 {boundedPageIndex + 1} / {visiblePages.length} 页
          </span>
          <span>已回答 {answeredCount} / {totalQuestions} 题 <strong>{progress}%</strong></span>
        </div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} aria-label="已回答的题目比例">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <ol className="page-steps">{visiblePages.map((page, index) => <li key={page.id} className={index === boundedPageIndex ? "active" : index < boundedPageIndex ? "complete" : ""} aria-current={index === boundedPageIndex ? "step" : undefined}><span>{index < boundedPageIndex ? <Check size={12} /> : index + 1}</span><small>{page.title || `第 ${index + 1} 页`}</small></li>)}</ol>
      </section>

      <form className="survey-form" noValidate onSubmit={(event) => { event.preventDefault(); if (isLastPage) submit(); else goNext(); }}>
        <div className="page-title">
          <p className="eyebrow">SECTION {String(boundedPageIndex + 1).padStart(2, "0")}</p>
          <h2>{currentPage.title}</h2>
          <span>标记「必填」的问题需要作答，其余可按需填写。</span>
        </div>

        {boundedPageIndex === 0 && survey.computedFields?.length > 0 && (
          <ComputedFieldsPanel fields={survey.computedFields} values={computedValues} />
        )}

        {Object.values(errors).some(Boolean) && <p className="validation-summary" role="alert">还有 {Object.values(errors).filter(Boolean).length} 项需要检查，请完善下方标记的问题。</p>}
        <fieldset className="runner-fields" disabled={submission.status === "submitting"}>
        {currentPage.questions.map((question, index) => (
          <QuestionField
            key={question.id}
            question={question}
            number={offset + index + 1}
            answer={answers[question.id]}
            error={errors[question.id]}
            onChange={(nextAnswer) => updateAnswer(question, nextAnswer)}
          />
        ))}
        </fieldset>

        {submission.status === "error" && <div className="form-error" role="alert">{submission.message}</div>}

        <div className="actions">
          <button type="button" className="secondary-button" onClick={goBack} disabled={boundedPageIndex === 0 || submission.status === "submitting"}>
            <ArrowLeft size={18} />
            上一页
          </button>
          {isLastPage ? (
            <button type="submit" className="primary-button" disabled={submission.status === "submitting"}>
              {submission.status === "submitting" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {survey.submitButtonText || "提交问卷"}
            </button>
          ) : (
            <button type="submit" className="primary-button">
              下一页
              <ArrowRight size={18} />
            </button>
          )}
        </div>
      </form>
      <p className="draft-footnote"><ShieldCheck size={13} />草稿仅保存在本标签页，提交后自动清除。</p>
    </>
  );
}

function QuestionField({ question, number, answer = {}, error, onChange }) {
  const fieldId = `question-${question.id}`;

  return (
    <fieldset id={`field-${question.id}`} tabIndex={-1} className={`question ${error ? "has-error" : ""}`} aria-describedby={error ? `error-${question.id}` : undefined}>
      <legend id={`label-${question.id}`}>
        <span className="question-number">{String(number).padStart(2, "0")}</span><span className="question-title">{question.title}</span>
        <span className={question.required ? "required-label" : "optional-label"}>{question.required ? "必填" : "选填"}</span>
      </legend>
      {question.description && <p className="question-description">{question.description}</p>}

      {question.type === "singleChoice" && (
        <ChoiceList question={question} answer={answer} multiple={false} onChange={onChange} />
      )}

      {question.type === "multipleChoice" && (
        <ChoiceList question={question} answer={answer} multiple onChange={onChange} />
      )}

      {question.type === "rating" && <RatingField question={question} answer={answer} onChange={onChange} />}

      {question.type === "dateParts" && <DatePartsField question={question} answer={answer} onChange={onChange} />}

      {question.type === "text" && (
        <input
          id={fieldId}
          className="text-input"
          inputMode={question.inputMode || "text"}
          aria-labelledby={`label-${question.id}`}
          aria-invalid={!!error}
          aria-describedby={error ? `error-${question.id}` : undefined}
          maxLength={10000}
          value={answer.value || ""}
          placeholder={question.placeholder || ""}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      )}

      {question.type === "textarea" && (
        <textarea
          id={fieldId}
          className="text-area"
          aria-labelledby={`label-${question.id}`}
          aria-invalid={!!error}
          aria-describedby={error ? `error-${question.id}` : undefined}
          maxLength={10000}
          value={answer.value || ""}
          placeholder={question.placeholder || ""}
          rows={5}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      )}

      {error && <p className="error-text" id={`error-${question.id}`}>{error}</p>}
    </fieldset>
  );
}

function ComputedFieldsPanel({ fields, values }) {
  return (
    <div className="computed-panel" aria-label="自动计算信息">
      {fields.map((field) => (
        <div className="computed-item" key={field.id}>
          <span>{field.label}</span>
          <strong>{values[field.id]?.displayValue || "待填写"}</strong>
        </div>
      ))}
    </div>
  );
}

function DatePartsField({ question, answer = {}, onChange }) {
  const value = answer.value || {};

  function updatePart(part, nextValue) {
    const cleaned = nextValue.replace(/[^\d]/g, "");
    onChange({
      value: {
        ...value,
        [part]: cleaned
      }
    });
  }

  return (
    <div className="date-parts" aria-label={question.title}>
      <label>
        年
        <input
          className="text-input"
          inputMode="numeric"
          maxLength={4}
          value={value.year || ""}
          placeholder="2024"
          onChange={(event) => updatePart("year", event.target.value)}
        />
      </label>
      <label>
        月
        <input
          className="text-input"
          inputMode="numeric"
          maxLength={2}
          value={value.month || ""}
          placeholder="6"
          onChange={(event) => updatePart("month", event.target.value)}
        />
      </label>
      <label>
        日
        <input
          className="text-input"
          inputMode="numeric"
          maxLength={2}
          value={value.day || ""}
          placeholder="21"
          onChange={(event) => updatePart("day", event.target.value)}
        />
      </label>
    </div>
  );
}

function ChoiceList({ question, answer = {}, multiple, onChange }) {
  const selected = multiple ? answer.value || [] : answer.value;

  function toggleOption(option) {
    if (multiple) {
      const exists = selected.includes(option.value);
      const nextSelected = exists
        ? selected.filter((value) => value !== option.value)
        : [...selected, option.value];
      const nextTextValue = { ...(answer.textValue || {}) };
      if (exists) delete nextTextValue[option.value];
      onChange({ value: nextSelected, textValue: nextTextValue });
      return;
    }

    const nextTextValue = option.allowText ? answer.textValue || {} : {};
    onChange({ value: option.value, textValue: nextTextValue });
  }

  function updateOptionText(option, text) {
    onChange({
      value: selected,
      textValue: {
        ...(answer.textValue || {}),
        [option.value]: text
      }
    });
  }

  return (
    <div className="choice-list">
      {(question.options || []).map((option) => {
        const checked = multiple ? selected.includes(option.value) : selected === option.value;
        return (
          <label key={option.value} className={`choice ${checked ? "selected" : ""}`}>
            <span className="choice-row">
              <input
                type={multiple ? "checkbox" : "radio"}
                name={question.id}
                checked={checked}
                onChange={() => toggleOption(option)}
              />
              <span>{option.label}</span>
            </span>
            {option.allowText && checked && (
              <input
                className="inline-text-input"
                aria-label={`${option.label}的补充说明`}
                maxLength={10000}
                value={answer.textValue?.[option.value] || ""}
                placeholder={option.textPlaceholder || "请填写"}
                onChange={(event) => updateOptionText(option, event.target.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}

function RatingField({ question, answer = {}, onChange }) {
  const { min, max, minLabel, maxLabel } = question.scale;
  const values = Array.from({ length: max - min + 1 }, (_, index) => min + index);

  return (
    <div className="rating-block">
      <div className="rating-options">
        {values.map((value) => (
          <button
            key={value}
            type="button"
            className={answer.value === value ? "rating selected" : "rating"}
            aria-pressed={answer.value === value}
            aria-label={`${question.title}：${value} 分`}
            onClick={() => onChange({ value })}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="rating-labels">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}
