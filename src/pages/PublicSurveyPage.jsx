import React, { useEffect, useState } from "react";
import SurveyRunner from "../components/SurveyRunner.jsx";
import { fetchPublicSurvey, submitPublicResponse } from "../lib/api";

export default function PublicSurveyPage({ slug }) {
  const [survey, setSurvey] = useState(null);
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("");
  const previewToken = new URLSearchParams(window.location.search).get("previewToken");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    fetchPublicSurvey(slug)
      .then((payload) => {
        if (!alive) return;
        setSurvey(payload.survey);
        setStatus("ready");
      })
      .catch((error) => {
        if (!alive) return;
        setMessage(error.message);
        setStatus("error");
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  return (
    <main className="app-shell">
      {status === "loading" && <section className="survey-form">正在加载问卷...</section>}
      {status === "error" && <section className="survey-form form-error">{message || "问卷不可用"}</section>}
      {status === "ready" && !survey && <section className="survey-form form-error">问卷加载失败</section>}
      {status === "ready" && survey && (
        <>
          <section className="survey-header">
            <div>
              <p className="eyebrow">问卷</p>
              <h1>{survey.title}</h1>
              <p>{survey.description}</p>
            </div>
          </section>
          <SurveyRunner
            survey={survey}
            onSubmit={(response) => submitPublicResponse({
              ...response,
              metadata: {
                ...response.metadata,
                previewToken,
                isPreview: Boolean(previewToken)
              }
            })}
          />
        </>
      )}
    </main>
  );
}
