import React from "react";
import { buildQuestionMap, formatAnswerValue, formatDuration, formatTextValue } from "../lib/responses";

export default function ResponseDetail({ row, definition }) {
  const questions = buildQuestionMap(definition);
  const computed = Object.entries(row.response?.computedValues || {});
  return <div className="response-detail">
    <div className="detail-caption"><span>填写用时 {formatDuration(row.response?.durationMs)}</span><code>{row.id}</code></div>
    {computed.length > 0 && <div className="detail-section"><h3>自动计算</h3><div className="detail-grid compact">
      {computed.map(([id, value]) => <div className="detail-item highlight" key={id}><span>{value.label || id}</span><strong>{value.displayValue ?? value.value ?? "未计算"}</strong></div>)}
    </div></div>}
    <div className="detail-section"><h3>题目答案</h3><div className="detail-grid">
      {(row.response?.answers || []).map((answer, index) => {
        const question = questions.get(answer.questionId);
        const text = formatTextValue(answer.textValue, question);
        const value = formatAnswerValue(answer, question);
        return <div className="detail-item" key={answer.questionId}><span><small>{String(index + 1).padStart(2, "0")}</small>{question?.title || answer.questionId}</span>
          <strong>{value === "" || value == null ? "未填写" : value}</strong>{text && <em>{text}</em>}
        </div>;
      })}
    </div></div>
  </div>;
}
