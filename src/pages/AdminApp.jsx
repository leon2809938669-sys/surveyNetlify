import React, { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import * as XLSX from "xlsx";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Eye,
  Loader2,
  LogOut,
  Plus,
  Save,
  Trash2
} from "lucide-react";
import {
  deleteAdminSurvey,
  fetchAdminResponses,
  fetchAdminSurveys,
  loginAdmin,
  saveAdminSurvey
} from "../lib/api";
import { getPublicSurveyUrl } from "../lib/routes";
import exampleSurvey from "../data/survey.example.json";

const TOKEN_KEY = "survey_admin_token";

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");

  if (!token) {
    return (
      <main className="admin-shell">
        <section className="login-panel">
          <p className="eyebrow">管理入口</p>
          <h1>问卷管理</h1>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setLoginError("");
              try {
                const payload = await loginAdmin(password);
                if (!payload.token) throw new Error("登录失败：服务端没有返回 token");
                localStorage.setItem(TOKEN_KEY, payload.token);
                setToken(payload.token);
              } catch (error) {
                setLoginError(error.message);
              }
            }}
          >
            <input
              className="text-input"
              type="password"
              autoComplete="current-password"
              value={password}
              placeholder="管理密码"
              onChange={(event) => setPassword(event.target.value)}
            />
            {loginError && <p className="error-text">{loginError}</p>}
            <button className="primary-button full-button" type="submit">
              登录
            </button>
          </form>
        </section>
      </main>
    );
  }

  return <AdminDashboard token={token} onLogout={() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken("");
  }} />;
}

function AdminDashboard({ token, onLogout }) {
  const [surveys, setSurveys] = useState([]);
  const [selected, setSelected] = useState(null);
  const [definitionText, setDefinitionText] = useState("");
  const [responses, setResponses] = useState([]);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [expandedResponseId, setExpandedResponseId] = useState("");

  useEffect(() => {
    loadSurveys();
  }, []);

  useEffect(() => {
    if (!selected?.slug) {
      setQrDataUrl("");
      return;
    }

    QRCode.toDataURL(getPublicSurveyUrl(selected.slug), {
      margin: 1,
      width: 180,
      color: { dark: "#18202f", light: "#ffffff" }
    }).then(setQrDataUrl);
  }, [selected?.slug]);

  const selectedPublicUrl = selected?.slug ? getPublicSurveyUrl(selected.slug) : "";
  const selectedDefinition = useMemo(() => {
    try {
      return JSON.parse(definitionText);
    } catch {
      return null;
    }
  }, [definitionText]);

  async function loadSurveys() {
    setStatus("loading");
    try {
      const payload = await fetchAdminSurveys(token);
      setSurveys(payload.surveys);
      if (payload.surveys.length > 0) {
        selectSurvey(payload.surveys[0]);
      } else {
        createDraft();
      }
      setStatus("ready");
    } catch (error) {
      setMessage(error.message);
      setStatus("error");
    }
  }

  function selectSurvey(survey) {
    setSelected(survey);
    setDefinitionText(JSON.stringify(survey.definition, null, 2));
    setResponses([]);
    setExpandedResponseId("");
    if (survey.id) {
      loadResponses(survey.id);
    }
  }

  function createDraft() {
    const draft = {
      id: "",
      slug: `survey-${Date.now()}`,
      status: "draft",
      definition: {
        ...exampleSurvey,
        id: `survey-${Date.now()}`,
        version: 1
      }
    };
    setSelected(draft);
    setDefinitionText(JSON.stringify(draft.definition, null, 2));
    setResponses([]);
    setExpandedResponseId("");
  }

  async function loadResponses(surveyId) {
    try {
      const payload = await fetchAdminResponses(token, surveyId);
      setResponses(payload.responses);
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function saveSurvey() {
    setMessage("");
    let definition;
    try {
      definition = JSON.parse(definitionText);
    } catch {
      setMessage("问卷 JSON 格式不正确");
      return;
    }

    try {
      const payload = await saveAdminSurvey(token, {
        ...selected,
        definition,
        title: definition.title,
        description: definition.description
      });
      setSelected(payload.survey);
      setDefinitionText(JSON.stringify(payload.survey.definition, null, 2));
      const list = await fetchAdminSurveys(token);
      setSurveys(list.surveys);
      setMessage("已保存");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function removeSurvey() {
    if (!selected?.id) return;
    const confirmed = window.confirm("确认删除这个问卷？答卷不会自动删除。");
    if (!confirmed) return;

    try {
      await deleteAdminSurvey(token, selected.id);
      setMessage("已删除");
      await loadSurveys();
    } catch (error) {
      setMessage(error.message);
    }
  }

  function copyPublicUrl() {
    navigator.clipboard.writeText(selectedPublicUrl);
    setMessage("链接已复制");
  }

  function exportResponses() {
    const rows = responses.map((row) => flattenResponse(row, selected.definition));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "responses");
    XLSX.writeFile(book, `${selected.slug || "survey"}-responses.xlsx`);
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div>
          <p className="eyebrow">管理后台</p>
          <h1>问卷与答卷</h1>
        </div>
        <button className="secondary-button" type="button" onClick={onLogout}>
          <LogOut size={18} />
          退出
        </button>
      </header>

      {status === "loading" && (
        <section className="admin-panel inline-status">
          <Loader2 className="spin" size={18} />
          正在加载
        </section>
      )}

      {status === "error" && <section className="admin-panel form-error">{message}</section>}

      {status === "ready" && selected && (
        <section className="admin-layout">
          <aside className="admin-panel survey-list">
            <button className="primary-button full-button" type="button" onClick={createDraft}>
              <Plus size={18} />
              新建问卷
            </button>
            {surveys.map((survey) => (
              <button
                key={survey.id}
                className={`survey-list-item ${selected.id === survey.id ? "active" : ""}`}
                type="button"
                onClick={() => selectSurvey(survey)}
              >
                <strong>{survey.title || survey.slug}</strong>
                <span>{survey.status} · {survey.responseCount || 0} 份答卷</span>
              </button>
            ))}
          </aside>

          <section className="admin-panel editor-panel">
            <div className="editor-grid">
              <label>
                Slug
                <input
                  className="text-input"
                  value={selected.slug}
                  onChange={(event) => setSelected({ ...selected, slug: event.target.value })}
                />
              </label>
              <label>
                状态
                <select
                  className="text-input"
                  value={selected.status}
                  onChange={(event) => setSelected({ ...selected, status: event.target.value })}
                >
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                  <option value="closed">closed</option>
                </select>
              </label>
            </div>

            <label className="json-editor-label">
              问卷 JSON
              <textarea
                className="json-editor"
                value={definitionText}
                spellCheck={false}
                onChange={(event) => setDefinitionText(event.target.value)}
              />
            </label>

            <div className="admin-actions">
              <button className="primary-button" type="button" onClick={saveSurvey}>
                <Save size={18} />
                保存
              </button>
              <button className="secondary-button" type="button" onClick={removeSurvey} disabled={!selected.id}>
                <Trash2 size={18} />
                删除
              </button>
            </div>

            {message && <p className="admin-message">{message}</p>}
            {!selectedDefinition && <p className="error-text">JSON 尚未通过解析</p>}
          </section>

          <aside className="admin-panel share-panel">
            <h2>发布入口</h2>
            <p className="muted-text">状态为 published 后，被调查者可访问。</p>
            {qrDataUrl && <img className="qr-code" src={qrDataUrl} alt="问卷二维码" />}
            <div className="public-url">{selectedPublicUrl}</div>
            <div className="admin-actions">
              <button className="secondary-button" type="button" onClick={copyPublicUrl}>
                <Copy size={18} />
                复制
              </button>
              <a className="secondary-button" href={selectedPublicUrl} target="_blank" rel="noreferrer">
                <Eye size={18} />
                预览
              </a>
            </div>
          </aside>

          <section className="admin-panel responses-panel">
            <div className="responses-header">
              <div>
                <h2>答卷</h2>
                <p className="muted-text">{responses.length} 份</p>
              </div>
              <button className="primary-button" type="button" onClick={exportResponses} disabled={responses.length === 0}>
                <Download size={18} />
                导出 xlsx
              </button>
            </div>
            <div className="responses-table-wrap">
              <table className="responses-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>提交时间</th>
                    <th>答卷 ID</th>
                    <th>题目数</th>
                  </tr>
                </thead>
                <tbody>
                  {responses.map((row) => (
                    <React.Fragment key={row.id}>
                      <tr
                        className={`response-row ${expandedResponseId === row.id ? "active" : ""}`}
                        onClick={() => setExpandedResponseId((current) => current === row.id ? "" : row.id)}
                      >
                        <td>
                          <button className="icon-button" type="button" aria-label="展开答卷">
                            {expandedResponseId === row.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                        </td>
                        <td>{new Date(row.submitted_at).toLocaleString()}</td>
                        <td>{row.id}</td>
                        <td>{row.response?.answers?.length || 0}</td>
                      </tr>
                      {expandedResponseId === row.id && (
                        <tr className="response-detail-row">
                          <td colSpan={4}>
                            <ResponseDetail row={row} definition={selected.definition} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      )}
    </main>
  );
}

function ResponseDetail({ row, definition }) {
  const questionMap = buildQuestionMap(definition);
  const computedItems = (definition?.computedFields || []).map((field) => {
    const computed = row.response?.computedValues?.[field.id];
    return {
      id: field.id,
      label: field.label || field.id,
      value: computed?.displayValue ?? computed?.value ?? "未计算"
    };
  });

  const answerItems = (row.response?.answers || []).map((answer) => {
    const question = questionMap.get(answer.questionId);
    const textValue = formatTextValue(answer.textValue, question);
    return {
      id: answer.questionId,
      label: question?.title || answer.questionId,
      value: formatAnswerValue(answer, question) || "未填写",
      textValue
    };
  });

  return (
    <div className="response-detail">
      {computedItems.length > 0 && (
        <div className="detail-section">
          <h3>自动计算</h3>
          <div className="detail-grid compact">
            {computedItems.map((item) => (
              <div className="detail-item highlight" key={item.id}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="detail-section">
        <h3>题目答案</h3>
        <div className="detail-grid">
          {answerItems.map((item) => (
            <div className="detail-item" key={item.id}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              {item.textValue && <em>{item.textValue}</em>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function flattenResponse(row, definition) {
  const questionMap = buildQuestionMap(definition);
  const output = {
    "答卷ID": row.id,
    "问卷ID": row.survey_id,
    "问卷版本": row.survey_version,
    "提交者ID": row.respondent_id,
    "提交时间": row.submitted_at,
    "填写时长毫秒": row.response?.durationMs ?? ""
  };

  for (const field of definition?.computedFields || []) {
    const computed = row.response?.computedValues?.[field.id];
    output[field.label || field.id] = computed?.displayValue ?? computed?.value ?? "";
  }

  for (const answer of row.response?.answers || []) {
    const question = questionMap.get(answer.questionId);
    const columnName = question?.title || answer.questionId;
    output[columnName] = formatAnswerValue(answer, question);

    const textValue = formatTextValue(answer.textValue, question);
    if (textValue) {
      output[`${columnName}（补充说明）`] = textValue;
    }
  }

  return output;
}

function buildQuestionMap(definition) {
  const questions = definition?.pages?.flatMap((page) => page.questions || []) || [];
  return new Map(questions.map((question) => [question.id, question]));
}

function formatAnswerValue(answer, question) {
  if (question?.type === "dateParts") {
    return formatDateParts(answer.value);
  }

  if (!question?.options) {
    return Array.isArray(answer.value) ? answer.value.join(", ") : answer.value ?? "";
  }

  const labelMap = new Map(question.options.map((option) => [option.value, option.label]));
  if (Array.isArray(answer.value)) {
    return answer.value.map((value) => labelMap.get(value) || value).join(", ");
  }
  return labelMap.get(answer.value) || (answer.value ?? "");
}

function formatDateParts(value) {
  if (!value?.year || !value?.month || !value?.day) return "";
  const month = String(Number(value.month)).padStart(2, "0");
  const day = String(Number(value.day)).padStart(2, "0");
  return `${value.year}-${month}-${day}`;
}

function formatTextValue(textValue, question) {
  if (!textValue || Object.keys(textValue).length === 0) return "";

  const labelMap = new Map((question?.options || []).map((option) => [option.value, option.label]));
  return Object.entries(textValue)
    .filter(([, value]) => String(value || "").trim())
    .map(([key, value]) => `${labelMap.get(key) || key}：${value}`)
    .join("；");
}
