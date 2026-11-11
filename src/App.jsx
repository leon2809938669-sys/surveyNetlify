import React, { lazy, Suspense } from "react";
import { getRoute } from "./lib/routes";

const AdminApp = lazy(() => import("./pages/AdminApp.jsx"));
const PublicSurveyPage = lazy(() => import("./pages/PublicSurveyPage.jsx"));

class ErrorBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="initial-loading"><div><p>界面出现异常，请重新加载后重试。</p><button className="secondary-button" type="button" onClick={() => window.location.reload()}>重新加载</button></div></main>;
    return this.props.children;
  }
}

export default function App() {
  const route = getRoute();
  return <ErrorBoundary><Suspense fallback={<main className="initial-loading" role="status"><span className="loading-dot" />正在准备工作空间…</main>}>
    {route.name === "admin" ? <AdminApp /> : <PublicSurveyPage slug={route.slug} />}
  </Suspense></ErrorBoundary>;
}
