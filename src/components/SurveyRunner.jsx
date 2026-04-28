import React, { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Send } from "lucide-react";
import {
  buildResponsePayload,
  getVisiblePages,
  isAnswered,
  pruneHiddenAnswers,
  validatePage
} from "../lib/surveyEngine";

export default function SurveyRunner({ survey, onSubmit }) {
  const [answers, setAnswers] = useState({});
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [errors, setErrors] = useState({});
  const [startedAt] = useState(() => new Date().toISOString());
  const [submission, setSubmission] = useState({ status: "idle", message: "" });

  const visiblePages = useMemo(() => getVisiblePages(survey, answers), [survey, answers]);
  const boundedPageIndex = Math.min(currentPageIndex, Math.max(visiblePages.length - 1, 0));
  const currentPage = visiblePages[boundedPageIndex];
  const totalQuestions = visiblePages.reduce((sum, page) => sum + page.questions.length, 0);
  const answeredCount = visiblePages
    .flatMap((page) => page.questions)
    .filter((question) => isAnswered(question, answers[question.id])).length;
  const progress = totalQuestions ? Math.round((answeredCount / totalQuestions) * 100) : 0;
  const isLastPage = boundedPageIndex >= visiblePages.length - 1;

  function updateAnswer(question, nextAnswer) {
    setErrors((current) => ({ ...current, [question.id]: "" }));
    setAnswers((current) => pruneHiddenAnswers(survey, { ...current, [question.id]: nextAnswer }));
  }

  function goBack() {
    setCurrentPageIndex((index) => Math.max(0, index - 1));
  }

  function goNext() {
    const pageErrors = validatePage(currentPage, answers);
    setErrors(pageErrors);
    if (Object.keys(pageErrors).length > 0) return;
    setCurrentPageIndex((index) => Math.min(visiblePages.length - 1, index + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    const pageErrors = validatePage(currentPage, answers);
    setErrors(pageErrors);
    if (Object.keys(pageErrors).length > 0) return;

    setSubmission({ status: "submitting", message: "" });
    try {
      const payload = buildResponsePayload({ survey, answers, startedAt });
      await onSubmit(payload);
      setSubmission({ status: "submitted", message: "提交成功" });
    } catch (error) {
      setSubmission({ status: "error", message: error.message || "提交失败，请稍后再试" });
    }
  }

  if (submission.status === "submitted") {
    return (
      <section className="complete-panel">
        <div className="complete-icon">
          <Check size={34} />
        </div>
        <h1>{survey.completionTitle || "感谢你的反馈"}</h1>
        <p>{survey.completionMessage || submission.message}</p>
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
      <section className="progress-block" aria-label="填写进度">
        <div className="progress-meta">
          <span>
            第 {boundedPageIndex + 1} / {visiblePages.length} 页
          </span>
          <span>{progress}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <form className="survey-form" onSubmit={(event) => event.preventDefault()}>
        <div className="page-title">
          <h2>{currentPage.title}</h2>
        </div>

        {currentPage.questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            answer={answers[question.id]}
            error={errors[question.id]}
            onChange={(nextAnswer) => updateAnswer(question, nextAnswer)}
          />
        ))}

        {submission.status === "error" && <div className="form-error">{submission.message}</div>}

        <div className="actions">
          <button type="button" className="secondary-button" onClick={goBack} disabled={boundedPageIndex === 0}>
            <ArrowLeft size={18} />
            上一页
          </button>
          {isLastPage ? (
            <button type="button" className="primary-button" onClick={submit} disabled={submission.status === "submitting"}>
              {submission.status === "submitting" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {survey.submitButtonText || "提交问卷"}
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={goNext}>
              下一页
              <ArrowRight size={18} />
            </button>
          )}
        </div>
      </form>
    </>
  );
}

function QuestionField({ question, answer = {}, error, onChange }) {
  const fieldId = `question-${question.id}`;

  return (
    <fieldset className={`question ${error ? "has-error" : ""}`}>
      <legend>
        {question.title}
        {question.required && <span aria-label="必填">*</span>}
      </legend>

      {question.type === "singleChoice" && (
        <ChoiceList question={question} answer={answer} multiple={false} onChange={onChange} />
      )}

      {question.type === "multipleChoice" && (
        <ChoiceList question={question} answer={answer} multiple onChange={onChange} />
      )}

      {question.type === "rating" && <RatingField question={question} answer={answer} onChange={onChange} />}

      {question.type === "text" && (
        <input
          id={fieldId}
          className="text-input"
          inputMode={question.inputMode || "text"}
          value={answer.value || ""}
          placeholder={question.placeholder || ""}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      )}

      {question.type === "textarea" && (
        <textarea
          id={fieldId}
          className="text-area"
          value={answer.value || ""}
          placeholder={question.placeholder || ""}
          rows={5}
          onChange={(event) => onChange({ value: event.target.value })}
        />
      )}

      {error && <p className="error-text">{error}</p>}
    </fieldset>
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
      {question.options.map((option) => {
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
