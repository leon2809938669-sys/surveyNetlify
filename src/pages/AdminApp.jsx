import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardList, Copy, Download, Eye, EyeOff, FileJson, FileText, Inbox, Loader2,
  LockKeyhole, LogOut, Plus, RefreshCw, Save, Search, ShieldCheck, Trash2, Upload, X
} from "lucide-react";
import {
  clearAdminResponses, deleteAdminResponses, deleteAdminSurvey, fetchAdminBackup, fetchAdminResponses,
  fetchAdminSession, fetchAdminSurveys, loginAdmin, logoutAdmin, saveAdminSurvey
} from "../lib/api";
import { getPreviewSurveyUrl, getPublicSurveyUrl } from "../lib/routes";
import { validateDefinition } from "../lib/definition";
import { downloadExcel, downloadJson } from "../lib/download";
import { flattenResponse, formatDuration, formatTime } from "../lib/responses";
import Brand from "../components/Brand.jsx";
import ResponseDetail from "../components/ResponseDetail.jsx";
import VisualSurveyEditor from "../components/VisualSurveyEditor.jsx";

const PAGE_SIZE = 20;
const fingerprint = (survey, text) => JSON.stringify([survey?.slug, survey?.status, text]);

function parseEditableDefinition(text) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value.title !== "string" || (value.description != null && typeof value.description !== "string") ||
      !["number", "string", "undefined"].includes(typeof value.version) || !Array.isArray(value.pages)) return null;
    for (const page of value.pages) {
      if (!page || typeof page.id !== "string" || (page.title != null && typeof page.title !== "string") || !Array.isArray(page.questions)) return null;
      for (const question of page.questions) {
        if (!question || typeof question.id !== "string" || typeof question.title !== "string" ||
          (question.options != null && (!Array.isArray(question.options) || question.options.some((option) => !option || typeof option.label !== "string" || !["string", "number"].includes(typeof option.value))))) return null;
      }
    }
    return value;
  } catch { return null; }
}

export default function AdminApp() {
  const [session, setSession] = useState("loading");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  useEffect(() => {
    document.title = "问卷工作台 · 管理空间";
    // Remove tokens left by the old implementation; sessions are now HttpOnly cookies.
    try { localStorage.removeItem("survey_admin_token"); } catch { /* Storage may be disabled. */ }
    let alive = true;
    fetchAdminSession().then(({ authenticated }) => { if (alive) setSession(authenticated ? "authenticated" : "anonymous"); })
      .catch((reason) => { if (alive) { setError(reason.message); setSession("anonymous"); } });
    const expired = () => { setSession("anonymous"); setError("登录已失效，请重新输入管理密码"); };
    window.addEventListener("survey:unauthorized", expired);
    return () => { alive = false; window.removeEventListener("survey:unauthorized", expired); };
  }, []);

  if (session === "loading") return <main className="initial-loading" role="status"><Loader2 className="spin" size={20} />正在打开管理空间…</main>;
  if (session === "authenticated") return <AdminDashboard onLogout={async () => { await logoutAdmin(); setSession("anonymous"); }} />;

  return <main className="login-shell">
    <header className="login-topbar"><Brand /><span className="private-label"><ShieldCheck size={15} />你的私有问卷空间</span></header>
    <div className="login-layout">
      <section className="login-intro">
        <span className="section-kicker"><span />让反馈自然发生</span>
        <h1>每一个声音，<br />都值得<span>被看见。</span></h1>
        <p>从一份用心设计的问卷开始。收集真实的想法，<br className="desktop-only" />发现数据背后的故事。</p>
        <div className="intro-features"><span><CheckCircle2 size={17} />灵活的问卷编辑</span><span><CheckCircle2 size={17} />完整的数据掌控</span></div>
        <div className="intro-note"><div className="note-lines"><i /><i /><i /></div><span>更少干扰，<br /><strong>更多有价值的反馈。</strong></span></div>
      </section>
      <section className="login-panel">
        <div className="login-icon"><LockKeyhole size={23} /></div>
        <p className="eyebrow">WELCOME BACK</p><h2>进入工作台</h2><p className="login-description">输入管理密码，继续你的研究与发现。</p>
        <form onSubmit={async (event) => {
          event.preventDefault();
          if (loggingIn) return;
          setError(""); setLoggingIn(true);
          try { await loginAdmin(password); setPassword(""); setSession("authenticated"); }
          catch (reason) { setError(reason.message); }
          finally { setLoggingIn(false); }
        }}>
          <label className="visual-field" htmlFor="admin-password"><span>管理密码</span></label>
          <div className="password-field"><input id="admin-password" className="text-input" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} placeholder="请输入管理密码" disabled={loggingIn} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" className="password-toggle" aria-label={showPassword ? "隐藏密码" : "显示密码"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {error && <p className="error-text" role="alert">{error}</p>}
          <button className="primary-button full-button login-submit" type="submit" disabled={loggingIn}>{loggingIn ? <Loader2 className="spin" size={18} /> : <>进入工作台<ArrowRight size={18} /></>}</button>
        </form>
        <div className="login-security"><ShieldCheck size={15} /><span>安全会话 · 数据保存在自有服务器</span></div>
      </section>
    </div>
    <footer className="login-footer"><span>用心提问，认真倾听。</span><span>SURVEY WORKSPACE / 2026</span></footer>
  </main>;
}

function AdminDashboard({ onLogout }) {
  const [surveys, setSurveys] = useState([]);
  const [selected, setSelected] = useState(null);
  const [definitionText, setDefinitionText] = useState("");
  const [baseline, setBaseline] = useState("");
  const [status, setStatus] = useState("loading");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState("");
  const [surveyQuery, setSurveyQuery] = useState("");
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("visual");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [responses, setResponses] = useState([]);
  const [responsesLoading, setResponsesLoading] = useState(false);
  const [responsesError, setResponsesError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [responseQuery, setResponseQuery] = useState("");
  const [responseType, setResponseType] = useState("all");
  const [responsePage, setResponsePage] = useState(1);
  const [selectedIds, setSelectedIds] = useState([]);
  const [expandedId, setExpandedId] = useState("");
  const importInput = useRef(null);
  const dirty = Boolean(selected && fingerprint(selected, definitionText) !== baseline);
  const selectedDefinition = useMemo(() => parseEditableDefinition(definitionText), [definitionText]);

  useEffect(() => {
    let alive = true;
    fetchAdminSurveys().then(({ surveys: list }) => {
      if (!alive) return;
      setSurveys(list); if (list[0]) openSurvey(list[0]); setStatus("ready");
    }).catch((error) => { if (alive) { setNotice({ type: "error", text: error.message }); setStatus("error"); } });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    let alive = true;
    setResponses([]); setSelectedIds([]); setExpandedId(""); setResponsesError("");
    if (!selected?.id) { setResponsesLoading(false); return; }
    setResponsesLoading(true);
    fetchAdminResponses(selected.id).then(({ responses: rows }) => { if (alive) setResponses(rows); })
      .catch((error) => { if (alive) setResponsesError(error.message); })
      .finally(() => { if (alive) setResponsesLoading(false); });
    return () => { alive = false; };
  }, [selected?.id, refreshKey]);
  useEffect(() => {
    let alive = true;
    setQrDataUrl("");
    if (selected?.id && selected.slug) QRCode.toDataURL(getPublicSurveyUrl(selected.slug), { margin: 2, width: 210, color: { dark: "#354b3b", light: "#ffffff" } })
      .then((data) => { if (alive) setQrDataUrl(data); }).catch(() => {});
    return () => { alive = false; };
  }, [selected?.id, selected?.slug]);
  useEffect(() => { setResponsePage(1); setSelectedIds([]); }, [responseQuery, responseType, selected?.id]);

  const totals = useMemo(() => ({ published: surveys.filter((survey) => survey.status === "published").length, responses: surveys.reduce((sum, survey) => sum + survey.responseCount, 0) }), [surveys]);
  const filteredSurveys = surveys.filter((survey) => `${survey.title} ${survey.slug}`.toLowerCase().includes(surveyQuery.toLowerCase()));
  const filteredResponses = useMemo(() => responses.filter((row) =>
    (responseType === "all" || (responseType === "preview") === Boolean(row.response?.metadata?.isPreview)) &&
    `${row.id} ${JSON.stringify(row.response?.answers || [])}`.toLowerCase().includes(responseQuery.toLowerCase())), [responses, responseType, responseQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredResponses.length / PAGE_SIZE));
  const page = Math.min(responsePage, pageCount);
  const visibleResponses = filteredResponses.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const questionCount = selectedDefinition?.pages?.reduce((sum, item) => sum + (item.questions?.length || 0), 0) || 0;
  const publicUrl = selected?.id ? getPublicSurveyUrl(selected.slug) : "";
  const isTunnel = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

  function confirmDiscard() { return !dirty || window.confirm("当前有未保存的修改。确定放弃这些修改吗？"); }
  function openSurvey(survey) {
    const text = JSON.stringify(survey.definition, null, 2);
    setSelected(survey); setDefinitionText(text); setBaseline(fingerprint(survey, text));
    setIsEditorOpen(false); setNotice(null); setResponseQuery(""); setResponseType("all");
  }
  function makeDraft(definition) {
    const slug = String(definition.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || `survey-${Date.now().toString(36)}`;
    setSelected({ id: "", slug, status: "unpublished", definition }); setDefinitionText(JSON.stringify(definition, null, 2));
    setBaseline(""); setIsEditorOpen(true); setEditorMode("visual"); setNotice(null);
  }
  function createDraft() {
    if (busy || !confirmDiscard()) return;
    makeDraft({ schema: "custom-survey.v1", id: `survey-${Date.now().toString(36)}`, version: 1, title: "未命名问卷", description: "感谢你抽出时间，分享真实的想法。", submitButtonText: "提交问卷",
      pages: [{ id: "page1", title: "听听你的想法", questions: [{ id: "question1", type: "textarea", title: "有什么想与我们分享的？", required: false }] }] });
  }
  async function runAction(name, action, success) {
    if (busy) return;
    setBusy(name); setNotice(null);
    try { await action(); if (success) setNotice({ type: "success", text: success }); }
    catch (error) { setNotice({ type: "error", text: error.message }); }
    finally { setBusy(""); }
  }
  async function updateCounts() { setSurveys((await fetchAdminSurveys()).surveys); }
  async function persist(nextStatus = selected.status) {
    let definition;
    try { definition = JSON.parse(definitionText); } catch { throw new Error("JSON 格式不正确，请检查后再保存"); }
    validateDefinition(definition);
    const { survey } = await saveAdminSurvey({ ...selected, status: nextStatus, definition });
    const text = JSON.stringify(survey.definition, null, 2);
    setSelected(survey); setDefinitionText(text); setBaseline(fingerprint(survey, text));
    await updateCounts();
  }
  async function removeSelectedResponses(ids, all = false) {
    const count = all ? responses.length : ids.length;
    if (!window.confirm(`确认${all ? "清空当前问卷全部" : "删除选中的"} ${count} 份答卷？建议先导出备份，此操作不可恢复。`)) return;
    await runAction("delete-responses", async () => {
      if (all) await clearAdminResponses(selected.id); else await deleteAdminResponses(selected.id, ids);
      setSelectedIds([]); setRefreshKey((key) => key + 1); await updateCounts();
    }, "答卷已删除");
  }
  async function importDefinition(event) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !confirmDiscard()) return;
    await runAction("import", async () => {
      if (file.size > 1024 * 1024) throw new Error("问卷 JSON 不能超过 1 MB");
      let definition;
      try { definition = JSON.parse(await file.text()); } catch { throw new Error("文件不是有效的 JSON"); }
      validateDefinition(definition); makeDraft(definition);
    }, "问卷 JSON 已载入，保存后生效");
  }
  const changePage = (value) => { setResponsePage(value); setSelectedIds([]); setExpandedId(""); };

  return <main className="admin-shell">
    <header className="workspace-topbar"><Brand /><div className="topbar-actions"><span className="private-label"><span className="connection-dot" />私有数据空间</span>
      <button className="secondary-button small" type="button" disabled={!!busy} onClick={() => runAction("backup", async () => downloadJson(await fetchAdminBackup(), `survey-backup-${new Date().toISOString().slice(0, 10)}.json`), "完整 JSON 备份已下载，请妥善保管")}>{busy === "backup" ? <Loader2 className="spin" size={15} /> : <Download size={15} />}备份数据</button>
      <button className="icon-button logout-button" type="button" aria-label="退出登录" disabled={!!busy} onClick={() => { if (confirmDiscard()) runAction("logout", onLogout); }}><LogOut size={18} /></button>
    </div></header>
    <section className="workspace-heading"><div><p className="eyebrow">你的研究，从这里开始</p><h1>让反馈，有所回响<span>.</span></h1><p>设计问卷、收集回答，在每一次倾听中发现新的可能。</p></div><button className="primary-button" type="button" onClick={createDraft} disabled={!!busy}><Plus size={18} />新建问卷</button></section>
    <section className="workspace-stats" aria-label="工作台概览">
      <StatCard label="全部问卷" value={surveys.length} icon={<ClipboardList size={20} />} hint="每一份探索的起点" />
      <StatCard label="正在收集" value={totals.published} icon={<span className="live-dot" />} hint="已发布的问卷" />
      <StatCard label="收到答卷" value={totals.responses} icon={<Inbox size={20} />} hint="每一个声音都很重要" accent />
    </section>
    {notice && <div className={`notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}><span>{notice.type === "success" && <CheckCircle2 size={17} />}{notice.text}</span><button type="button" className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {status === "loading" && <div className="admin-panel inline-status"><Loader2 className="spin" size={18} />正在加载你的问卷…</div>}
    {status === "error" && <button className="secondary-button" type="button" onClick={() => window.location.reload()}><RefreshCw size={16} />重新连接</button>}
    {status === "ready" && <section className="admin-layout">
      <aside className="survey-sidebar"><div className="sidebar-heading"><h2>我的问卷 <span>{surveys.length}</span></h2><button className="icon-button" type="button" aria-label="新建问卷" onClick={createDraft} disabled={!!busy}><Plus size={17} /></button></div>
        <label className="search-field"><Search size={16} /><input type="search" value={surveyQuery} onChange={(event) => setSurveyQuery(event.target.value)} placeholder="搜索问卷…" aria-label="搜索问卷" /></label>
        <div className="survey-list">{filteredSurveys.map((survey) => <button className={`survey-list-item ${selected?.id === survey.id ? "active" : ""}`} key={survey.id} type="button" disabled={!!busy} onClick={() => { if (selected?.id !== survey.id && confirmDiscard()) openSurvey(survey); }}>
          <span className="list-item-top"><FileText size={17} /><StatusBadge status={survey.status} /></span><strong>{survey.title || survey.slug}</strong><span className="list-item-footer"><span>{survey.responseCount} 份答卷</span><ChevronRight size={15} /></span>
        </button>)}{!filteredSurveys.length && <p className="sidebar-empty">{surveys.length ? "没有找到匹配的问卷" : "还没有问卷，开启第一次探索吧。"}</p>}</div>
        <button className="import-button" type="button" disabled={!!busy} onClick={() => importInput.current?.click()}><Upload size={16} />导入问卷 JSON</button><input ref={importInput} type="file" accept="application/json,.json" hidden onChange={importDefinition} />
        <div className="sidebar-note"><ShieldCheck size={17} /><p>问卷与答卷由你的服务器保存，<br />不依赖第三方数据服务。</p></div>
      </aside>
      <div className="workspace-content">
        {!selected && <section className="admin-panel empty-workspace"><div className="empty-icon"><ClipboardList size={32} /></div><p className="eyebrow">一份问卷，无限可能</p><h2>开始你的第一次倾听</h2><p>从一个问题开始，了解那些真正重要的想法。</p><button className="primary-button" type="button" onClick={createDraft}><Plus size={18} />创建第一份问卷</button></section>}
        {selected && <>
          <div className="selected-heading"><div><p className="eyebrow">问卷工作空间</p><h2>{selectedDefinition?.title || selected.title || "未命名问卷"}</h2></div><span className={`save-state ${dirty ? "is-dirty" : ""}`}><span />{dirty ? "有未保存的更改" : "所有更改已保存"}</span></div>
          <div className="survey-overview">
            <section className="admin-panel editor-panel">
              <div className="panel-heading"><h2><FileText size={18} />问卷设置</h2><StatusBadge status={selected.status} /></div>
              <fieldset className="editor-fields" disabled={!!busy}>
                <label className="visual-field"><span>填写链接标识 <small>Slug</small></span><input className="text-input slug-input" value={selected.slug} maxLength={128} onChange={(event) => setSelected({ ...selected, slug: event.target.value })} /></label>
                <p className="field-hint">字母、数字、下划线或短横线。修改后，原填写链接将不再可用。</p>
                <div className="definition-summary"><p>{selectedDefinition?.description || "为你的问卷添加一段简短说明。"}</p><div><span>{questionCount} 道题目</span><i /><span>{selectedDefinition?.pages?.length || 0} 个页面</span><i /><span>版本 {selectedDefinition?.version || 1}</span></div></div>
                <div className="editor-toolbar"><button className="secondary-button" type="button" onClick={() => setIsEditorOpen(!isEditorOpen)}><span>{isEditorOpen ? "收起编辑器" : "编辑问卷内容"}</span><ChevronDown size={16} className={isEditorOpen ? "rotate" : ""} /></button><button className="text-button" type="button" onClick={() => { if (!selectedDefinition) return; downloadJson(selectedDefinition, `${selected.slug || "survey"}.json`); }} disabled={!selectedDefinition}><FileJson size={16} />下载定义</button></div>
                {isEditorOpen && <div className="editor-expanded"><div className="editor-modebar"><div className="segmented-control" aria-label="编辑模式"><button type="button" className={editorMode === "visual" ? "active" : ""} onClick={() => setEditorMode("visual")}>可视化编辑</button><button type="button" className={editorMode === "json" ? "active" : ""} onClick={() => setEditorMode("json")}>JSON</button></div><span className="muted-text">同一份定义，两种编辑方式</span></div>
                  {editorMode === "visual" ? selectedDefinition ? <VisualSurveyEditor definition={selectedDefinition} onChange={(value) => setDefinitionText(JSON.stringify(value, null, 2))} /> : <p className="form-error" role="alert">JSON 结构不正确，请切换到 JSON 模式修正。</p> : <label className="json-editor-label">问卷 JSON<textarea className="json-editor" spellCheck={false} value={definitionText} onChange={(event) => setDefinitionText(event.target.value)} /></label>}
                </div>}
                <div className="editor-bottom-actions"><button className="primary-button" type="button" onClick={() => runAction("save", () => persist(), "问卷已保存")} disabled={!dirty}>{busy === "save" ? <Loader2 className="spin" size={17} /> : <Save size={17} />}保存修改</button>
                  <button className={selected.status === "published" ? "secondary-button" : "success-button"} type="button" onClick={() => { const next = selected.status === "published" ? "unpublished" : "published"; if (next === "unpublished" && !window.confirm("关闭后将停止收集新的答卷，已收集的数据不受影响。继续吗？")) return; runAction("publish", () => persist(next), next === "published" ? "问卷已发布，可以开始收集反馈" : "问卷已关闭"); }}>{busy === "publish" ? <Loader2 className="spin" size={17} /> : <span className="button-dot" />}{selected.status === "published" ? "停止收集" : "发布问卷"}</button>
                  <button className="icon-button danger delete-survey" type="button" aria-label="删除问卷" disabled={!selected.id} onClick={() => { if (!window.confirm("确认删除此问卷？已有答卷时必须先导出并清理答卷。此操作不可恢复。")) return; runAction("delete-survey", async () => { await deleteAdminSurvey(selected.id); const { surveys: list } = await fetchAdminSurveys(); setSurveys(list); if (list[0]) openSurvey(list[0]); else { setSelected(null); setBaseline(""); } }, "问卷已删除"); }}><Trash2 size={17} /></button>
                </div>
              </fieldset>
              {selected.updatedAt && <p className="updated-at">最后更新 {formatTime(selected.updatedAt)}</p>}
            </section>
            <aside className="admin-panel share-panel"><div className="panel-heading"><h2><ArrowUpRight size={18} />分享与预览</h2></div>
              {selected.id ? <><p className="muted-text">一份链接，让想法与你相遇。</p>{qrDataUrl && <img className="qr-code" src={qrDataUrl} alt="当前问卷的填写二维码" width="210" height="210" />}
                <label className="share-link-label"><span>填写链接</span><input className="public-url" readOnly value={publicUrl} onClick={(event) => event.target.select()} /></label>
                <button className="secondary-button full-button" type="button" onClick={async () => { try { await navigator.clipboard.writeText(publicUrl); setNotice({ type: "success", text: "填写链接已复制" }); } catch { setNotice({ type: "error", text: "无法自动复制，请在上方链接框内手动复制" }); } }}><Copy size={16} />复制链接</button>
                <a className="text-button preview-link" href={getPreviewSurveyUrl(selected.slug)} target="_blank" rel="noreferrer"><Eye size={16} />打开管理预览<ArrowUpRight size={14} /></a>
                {qrDataUrl && <a className="text-button qr-download" href={qrDataUrl} download={`${selected.slug}-qr.png`}><Download size={14} />下载二维码</a>}
                <p className="share-note">{isTunnel ? "当前是本机隧道预览。手机扫码需在配置正式域名后使用。" : selected.status === "published" ? "问卷正在收集答卷，可直接分享填写链接。" : "问卷尚未发布。管理预览可填写，答卷会标记为预览。"}</p>
                {dirty && <p className="share-warning">请先保存修改，再预览最新内容。</p>}
              </> : <div className="share-placeholder"><Eye size={30} /><p>保存问卷后，<br />即可预览并生成分享链接。</p></div>}
            </aside>
          </div>
          <section className="admin-panel responses-panel">
            <div className="responses-header"><div><p className="eyebrow">每一份回答，都是新的线索</p><h2>收到的反馈 <span className="count-badge">{responses.length}</span></h2></div><div className="response-actions"><button className="icon-button" type="button" aria-label="刷新答卷" disabled={responsesLoading || !!busy || !selected.id} onClick={() => runAction("refresh", async () => { setRefreshKey((key) => key + 1); await updateCounts(); })}><RefreshCw size={16} className={responsesLoading ? "spin" : ""} /></button>
              <button className="secondary-button" type="button" disabled={!filteredResponses.length || responsesLoading || !!busy} onClick={() => runAction("export", () => downloadExcel(filteredResponses.map((row) => flattenResponse(row, selected.definition)), `${selected.slug}-responses.xlsx`), "答卷表格已导出")}>{busy === "export" ? <Loader2 size={16} className="spin" /> : <Download size={16} />}导出 xlsx</button></div></div>
            {responses.length > 0 && <ResponseInsights responses={responses} />}
            <div className="response-filterbar"><label className="search-field"><Search size={16} /><input type="search" aria-label="搜索答卷" placeholder="搜索答卷 ID 或回答…" value={responseQuery} onChange={(event) => setResponseQuery(event.target.value)} /></label><select className="text-input response-type" aria-label="筛选答卷来源" value={responseType} onChange={(event) => setResponseType(event.target.value)}><option value="all">全部来源</option><option value="real">公开填写</option><option value="preview">管理预览</option></select></div>
            {responsesError && <p className="form-error" role="alert">{responsesError}，可点击刷新重试。</p>}
            {responsesLoading ? <div className="table-empty" role="status"><Loader2 className="spin" size={23} /><p>正在整理反馈…</p></div> : !filteredResponses.length ? <div className="table-empty"><Inbox size={32} /><h3>{responses.length ? "没有匹配的答卷" : "等待第一份反馈"}</h3><p>{responses.length ? "试试调整搜索内容或来源筛选。" : "发布并分享你的问卷，回答会出现在这里。"}</p></div> : <>
              <div className="responses-table-wrap"><table className="responses-table"><thead><tr><th><input type="checkbox" aria-label="选择本页全部答卷" checked={visibleResponses.length > 0 && visibleResponses.every((row) => selectedIds.includes(row.id))} onChange={() => setSelectedIds(visibleResponses.every((row) => selectedIds.includes(row.id)) ? [] : visibleResponses.map((row) => row.id))} /></th><th>提交时间</th><th>答卷标识</th><th>来源</th><th>填写用时</th><th>操作</th></tr></thead><tbody>
                {visibleResponses.map((row) => <React.Fragment key={row.id}><tr className={`response-row ${expandedId === row.id ? "active" : ""}`} onClick={() => setExpandedId(expandedId === row.id ? "" : row.id)}><td onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(row.id)} aria-label={`选择答卷 ${row.id}`} onChange={() => setSelectedIds((ids) => ids.includes(row.id) ? ids.filter((id) => id !== row.id) : [...ids, row.id])} /></td><td>{formatTime(row.submitted_at)}</td><td><code title={row.id}>{row.id.slice(0, 8)}…</code></td><td><span className={`source-badge ${row.response?.metadata?.isPreview ? "preview" : ""}`}>{row.response?.metadata?.isPreview ? "管理预览" : "公开填写"}</span></td><td>{formatDuration(row.response?.durationMs)}</td><td onClick={(event) => event.stopPropagation()}><div className="row-actions"><button className="icon-button" type="button" aria-label="查看答卷详情" aria-expanded={expandedId === row.id} onClick={() => setExpandedId(expandedId === row.id ? "" : row.id)}>{expandedId === row.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button><button className="icon-button danger" type="button" disabled={!!busy} aria-label="删除答卷" onClick={() => removeSelectedResponses([row.id])}><Trash2 size={15} /></button></div></td></tr>
                  {expandedId === row.id && <tr className="response-detail-row"><td colSpan={6}><ResponseDetail row={row} definition={selected.definition} /></td></tr>}
                </React.Fragment>)}
              </tbody></table></div>
              <div className="response-pagination"><span>共 {filteredResponses.length} 份 · 第 {page} / {pageCount} 页</span><div><button className="icon-button" type="button" aria-label="上一页答卷" disabled={page <= 1} onClick={() => changePage(page - 1)}><ChevronLeft size={17} /></button><button className="icon-button" type="button" aria-label="下一页答卷" disabled={page >= pageCount} onClick={() => changePage(page + 1)}><ChevronRight size={17} /></button></div></div>
            </>}
            {responses.length > 0 && <div className="response-bulk-actions"><span>{selectedIds.length ? `已选择 ${selectedIds.length} 份答卷` : "原始 JSON 可通过顶部「备份数据」完整下载"}</span><div>{selectedIds.length > 0 && <button className="text-button danger" type="button" disabled={!!busy} onClick={() => removeSelectedResponses(selectedIds)}><Trash2 size={14} />删除所选</button>}<button className="text-button danger" type="button" disabled={!!busy} onClick={() => removeSelectedResponses([], true)}>清空全部</button></div></div>}
          </section>
        </>}
      </div>
    </section>}
    <footer className="workspace-footer"><span>用心提问，认真倾听。</span><span><ShieldCheck size={13} />数据自主掌控</span></footer>
  </main>;
}

function StatusBadge({ status }) {
  return <span className={`status-badge ${status === "published" ? "published" : "unpublished"}`}><span />{status === "published" ? "收集中" : "未发布"}</span>;
}
function StatCard({ label, value, icon, hint, accent = false }) {
  return <div className={`stat-card ${accent ? "accent" : ""}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value.toLocaleString()}</strong><p>{hint}</p></div>;
}
function ResponseInsights({ responses }) {
  const real = responses.filter((row) => !row.response?.metadata?.isPreview);
  const durations = real.map((row) => row.response?.durationMs).filter((value) => Number.isFinite(value) && value >= 0);
  const average = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : null;
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setDate(date.getDate() - 6 + index); return date.toLocaleDateString("zh-CN"); });
  const counts = days.map((day) => real.filter((row) => new Date(row.submitted_at).toLocaleDateString("zh-CN") === day).length);
  const max = Math.max(1, ...counts);
  return <div className="response-insights"><div><span>正式答卷</span><strong>{real.length}<small>份</small></strong></div><div><span>平均填写用时</span><strong className="duration-value">{formatDuration(average)}</strong></div><div className="trend-insight"><div><span>近 7 天</span><strong>{counts.reduce((a, b) => a + b, 0)}<small>份反馈</small></strong></div><div className="mini-bars" aria-label="近七天答卷趋势">{counts.map((count, index) => <span key={days[index]} title={`${days[index]}：${count} 份`} style={{ height: `${Math.max(8, count / max * 100)}%` }} />)}</div></div></div>;
}
