import React, { useEffect, useState } from "react";
import { AlertCircle, ClipboardList, Clock3, Eye, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import Brand from "../components/Brand.jsx";
import SurveyRunner from "../components/SurveyRunner.jsx";
import { fetchPublicSurvey, submitPublicResponse } from "../lib/api";

export default function PublicSurveyPage({ slug }) {
  const [survey, setSurvey] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const isPreview = new URLSearchParams(window.location.search).get("preview") === "1";
  useEffect(() => {
    let alive = true;
    setStatus("loading");
    fetchPublicSurvey(slug, isPreview).then(({ survey: loaded }) => {
      if (!alive) return;
      if (!loaded) throw new Error("服务器未返回问卷");
      setSurvey(loaded); setStatus("ready"); document.title = `${loaded.title} · 问卷工作台`;
    }).catch((error) => { if (alive) { setMessage(error.message); setStatus("error"); } });
    return () => { alive = false; };
  }, [slug, isPreview, retry]);
  const count = survey?.pages?.reduce((sum, page) => sum + page.questions.length, 0) || 0;
  return <main className="app-shell">
    <div className="public-topbar"><Brand compact /><span><ShieldCheck size={15} />安心填写，认真倾听</span></div>
    {status === "loading" && <section className="survey-form public-loading" role="status" aria-busy="true"><Loader2 className="spin" size={25} /><p>正在准备你的问卷…</p><div className="skeleton-line" /><div className="skeleton-line short" /></section>}
    {status === "error" && <section className="survey-form public-error"><div className="empty-icon"><AlertCircle size={28} /></div><h1>暂时无法打开这份问卷</h1><p role="alert">{message || "问卷不可用，请稍后再试。"}</p><button className="secondary-button" type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={16} />重新加载</button>{isPreview && <a className="text-button" href="/admin">返回管理登录</a>}</section>}
    {status === "ready" && survey && <>
      {isPreview && <div className="preview-banner"><Eye size={18} /><div><strong>管理预览模式</strong><span>此处提交的答卷将单独标记，不计入正式答卷统计。</span></div></div>}
      <header className="survey-header"><p className="section-kicker"><span />期待听见你的声音</p><h1>{survey.title}</h1>{survey.description && <p className="survey-description">{survey.description}</p>}<div className="survey-meta"><span><ClipboardList size={15} />{count} 道题目</span><i /><span><Clock3 size={15} />预计 {Math.max(1, Math.ceil(count * 0.3))} 分钟</span><i /><span><ShieldCheck size={15} />自有服务器保存</span></div></header>
      <SurveyRunner key={`${survey.id}:${survey.updatedAt}:${isPreview}`} survey={survey} isPreview={isPreview} onSubmit={(response) => submitPublicResponse({ ...response, metadata: { ...response.metadata, isPreview } })} />
    </>}
    <footer className="public-footer"><ShieldCheck size={14} /><span>答卷由问卷管理者收集与保管 · 感谢你的每一次认真回答</span></footer>
  </main>;
}
