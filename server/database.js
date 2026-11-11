import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDatabase(filename) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
  db.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  return db;
}

export function decodeSurvey(row) {
  return row ? { ...row, definition: JSON.parse(row.definition) } : null;
}

export function normalizeSurvey(row) {
  const survey = decodeSurvey(row);
  return {
    id: survey.id,
    slug: survey.slug,
    status: survey.status,
    title: survey.title,
    description: survey.description,
    version: survey.version,
    definition: survey.definition,
    createdAt: survey.created_at,
    updatedAt: survey.updated_at,
    responseCount: Number(row.response_count || 0)
  };
}

export function decodeResponse(row) {
  const { submission_key, ...publicRow } = row;
  return { ...publicRow, response: JSON.parse(row.response) };
}

export function removePreviewCredential(response) {
  const clean = structuredClone(response);
  if (clean?.metadata && typeof clean.metadata === "object") delete clean.metadata.previewToken;
  return clean;
}

export function exportSnapshot(db) {
  return {
    schema: "survey-backup.v1",
    exportedAt: new Date().toISOString(),
    surveys: db.prepare("SELECT * FROM surveys ORDER BY id").all().map(decodeSurvey),
    survey_responses: db.prepare("SELECT * FROM survey_responses ORDER BY id").all().map(decodeResponse)
  };
}

// Insert-only, transactional and repeatable: never overwrite newer server data.
export function importSnapshot(db, snapshot, { dryRun = false } = {}) {
  const surveys = snapshot.surveys;
  const responses = snapshot.survey_responses ?? snapshot.responses ?? [];
  if (!Array.isArray(surveys) || !Array.isArray(responses)) throw new Error("需要 surveys 和 survey_responses 数组");
  const stats = { surveys: 0, responses: 0, skippedSurveys: 0, skippedResponses: 0, removedPreviewCredentials: 0, dryRun };
  const insertSurvey = db.prepare(`INSERT INTO surveys
    (id, slug, status, title, description, version, definition, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  const insertResponse = db.prepare(`INSERT INTO survey_responses
    (id, survey_id, survey_version, respondent_id, submitted_at, response, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of surveys) {
      if (!row.id || !row.slug || !row.definition || !row.created_at || !row.updated_at) throw new Error("问卷导入记录字段不完整");
      const definition = typeof row.definition === "string" ? JSON.parse(row.definition) : row.definition;
      const result = insertSurvey.run(row.id, row.slug, row.status === "published" ? "published" : "unpublished",
        row.title || definition.title || row.slug, row.description ?? "", Number(row.version || 1),
        JSON.stringify(definition), row.created_at, row.updated_at);
      stats[result.changes ? "surveys" : "skippedSurveys"] += 1;
    }
    for (const row of responses) {
      if (!row.id || !row.survey_id || !row.response || !row.submitted_at || !row.created_at) throw new Error("答卷导入记录字段不完整");
      const response = typeof row.response === "string" ? JSON.parse(row.response) : row.response;
      if (response.metadata?.previewToken) stats.removedPreviewCredentials += 1;
      const result = insertResponse.run(row.id, row.survey_id, Number(row.survey_version), row.respondent_id ?? null,
        row.submitted_at, JSON.stringify(removePreviewCredential(response)), row.created_at);
      stats[result.changes ? "responses" : "skippedResponses"] += 1;
    }
    db.exec(dryRun ? "ROLLBACK" : "COMMIT");
    return stats;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
