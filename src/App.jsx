import React from "react";
import AdminApp from "./pages/AdminApp.jsx";
import PublicSurveyPage from "./pages/PublicSurveyPage.jsx";
import { getRoute } from "./lib/routes";

export default function App() {
  const route = getRoute();
  return route.name === "admin" ? <AdminApp /> : <PublicSurveyPage slug={route.slug} />;
}
