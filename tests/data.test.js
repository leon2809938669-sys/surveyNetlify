import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createBackup } from "../server/backups.js";
import { exportSnapshot, importSnapshot, openDatabase } from "../server/database.js";
import { validateDefinition } from "../src/lib/definition.js";
import { computeSurveyValues, getBirthDateWarning, getDatePartsBounds, isAnswered, pruneHiddenAnswers, validateQuestion } from "../src/lib/surveyEngine.js";
import { flattenResponse, formatAnswerValue } from "../src/lib/responses.js";
import { validateResponse } from "../server/validation.js";

const snapshot = {
  surveys: [{ id: "original-survey-id", slug: "original-survey", status: "published", title: "原始问卷", description: "说明", version: 3,
    definition: { id: "business-id", version: 3, title: "原始问卷", pages: [{ id: "p", questions: [{ id: "q", type: "text", title: "原始问题" }] }] },
    created_at: "2026-01-01T00:00:00+00:00", updated_at: "2026-05-01T00:00:00+00:00" }],
  survey_responses: [{ id: "original-response-id", survey_id: "original-survey-id", survey_version: 3, respondent_id: "original-respondent",
    submitted_at: "2026-05-01T01:00:00+00:00", created_at: "2026-05-01T01:00:01+00:00",
    response: { schema: "custom-survey-response.v1", surveyId: "original-survey-id", surveyVersion: 3,
      respondent: { id: "original-respondent" }, answers: [{ questionId: "q", type: "text", value: "原始回答", textValue: null }],
      computedValues: {}, skipped: [], metadata: { storage: "supabase-postgres", isPreview: true, previewToken: "old-test-value-never-a-real-secret" } } }]
};

test("legacy rows preserve UUIDs, JSON, timestamps and versions except leaked preview credentials", () => {
  const db = openDatabase(":memory:");
  try {
    const dry = importSnapshot(db, snapshot, { dryRun: true });
    assert.equal(dry.surveys, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM surveys").get().count, 0);
    const result = importSnapshot(db, snapshot);
    assert.equal(result.responses, 1);
    assert.equal(result.removedPreviewCredentials, 1);
    const exported = exportSnapshot(db);
    assert.deepEqual(exported.surveys, snapshot.surveys);
    const expected = structuredClone(snapshot.survey_responses);
    delete expected[0].response.metadata.previewToken;
    assert.deepEqual(exported.survey_responses, expected);
    const repeated = importSnapshot(db, snapshot);
    assert.equal(repeated.surveys, 0);
    assert.equal(repeated.skippedResponses, 1);
  } finally { db.close(); }
});

test("foreign-key failure rolls back the whole import", () => {
  const db = openDatabase(":memory:");
  try {
    const invalid = structuredClone(snapshot);
    invalid.survey_responses[0].survey_id = "missing-survey";
    assert.throws(() => importSnapshot(db, invalid));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM surveys").get().count, 0);
  } finally { db.close(); }
});

test("SQLite backup restores a consistent database and refuses overwrites", async () => {
  const directory = mkdtempSync(join(tmpdir(), "survey-test-"));
  const db = openDatabase(join(directory, "live.sqlite"));
  try {
    importSnapshot(db, snapshot);
    const output = join(directory, "backup.sqlite");
    await createBackup(db, output);
    await assert.rejects(createBackup(db, output));
    assert.ok(readFileSync(output).length > 0);
    const restored = openDatabase(output);
    try { assert.deepEqual(exportSnapshot(restored).surveys, snapshot.surveys); } finally { restored.close(); }
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});

test("zero-valued choices and ratings are valid, all selected free-text options are checked", () => {
  assert.equal(isAnswered({ type: "singleChoice" }, { value: 0 }), true);
  assert.equal(isAnswered({ type: "rating" }, { value: 0 }), true);
  const question = { type: "multipleChoice", required: true, options: [{ value: "a", allowText: true }, { value: "b", allowText: true }] };
  assert.equal(validateQuestion(question, { value: ["a", "b"], textValue: { a: "filled" } }), "请补充填写");
  assert.ok(validateQuestion({ type: "dateParts" }, { value: { year: "2026", month: "2", day: "30" } }));
});

test("definition validation rejects duplicate IDs across pages and invalid regex", () => {
  const definition = structuredClone(snapshot.surveys[0].definition);
  definition.pages.push({ id: "p2", questions: [{ id: "q", type: "text", title: "重复" }] });
  assert.throws(() => validateDefinition(definition), /重复/);
  definition.pages.pop();
  definition.pages[0].questions[0].validation = { pattern: "[" };
  assert.throws(() => validateDefinition(definition), /正则/);
});

test("computed date fields remain compatible", () => {
  const values = computeSurveyValues({ computedFields: [{ id: "months", type: "monthsBetween", label: "月龄", fromQuestionId: "birth", to: "currentDate" }] },
    { birth: { value: { year: "2024", month: "1", day: "15" } } }, new Date(2026, 0, 14));
  assert.equal(values.months.value, 23);
});

const birthQuestion = { id: "birth", type: "dateParts", title: "出生日期", required: true, validation: { confirmAboveAgeYears: 6 } };
function dateAnswer(iso) {
  const [year, month, day] = iso.split("-");
  return { value: { year, month, day } };
}

test("birth dates allow older ages with a warning, while future and impossible dates remain invalid", () => {
  const now = new Date("2026-11-18T04:00:00Z");
  assert.deepEqual(getDatePartsBounds(birthQuestion, now), { min: "1900-01-01", max: "2026-11-18" });
  for (const iso of ["2018-12-01", "2019-11-18", "2019-11-19", "2020-11-18", "2026-11-18"]) {
    assert.equal(validateQuestion(birthQuestion, dateAnswer(iso), now), "");
  }
  for (const iso of ["2019-11-19", "2020-11-18", "2026-11-18"]) {
    assert.equal(getBirthDateWarning(birthQuestion, dateAnswer(iso), now), null);
  }
  assert.deepEqual(getBirthDateWarning(birthQuestion, dateAnswer("2019-11-18"), now),
    { ageYears: 7, thresholdYears: 6, date: "2019-11-18" });
  assert.equal(getBirthDateWarning(birthQuestion, dateAnswer("2018-12-01"), now).ageYears, 7);
  assert.match(validateQuestion(birthQuestion, dateAnswer("2026-11-19"), now), /不能晚于今天/);
  assert.equal(validateQuestion(birthQuestion, undefined, now), "请选择年、月、日");
  assert.match(validateQuestion(birthQuestion, { value: { year: "2024", month: "", day: "" } }, now), /完整/);
  assert.match(validateQuestion(birthQuestion, dateAnswer("2024-02-30"), now), /有效/);
});

test("birth age warnings handle leap days and change at midnight in China across runtime time zones", () => {
  assert.equal(getBirthDateWarning(birthQuestion, dateAnswer("2017-03-01"), new Date("2024-02-29T04:00:00Z")), null);
  assert.equal(getBirthDateWarning(birthQuestion, dateAnswer("2017-02-28"), new Date("2024-02-29T04:00:00Z")).ageYears, 7);
  assert.equal(getBirthDateWarning(birthQuestion, dateAnswer("2020-02-29"), new Date("2027-02-28T04:00:00Z")), null);
  assert.equal(getBirthDateWarning(birthQuestion, dateAnswer("2020-02-29"), new Date("2027-03-01T04:00:00Z")).ageYears, 7);
  assert.equal(validateQuestion(birthQuestion, dateAnswer("2020-02-29"), new Date("2027-02-28T04:00:00Z")), "");
  assert.equal(getDatePartsBounds(birthQuestion, new Date("2026-11-17T15:59:59Z")).max, "2026-11-17");
  assert.equal(getDatePartsBounds(birthQuestion, new Date("2026-11-17T16:00:00Z")).max, "2026-11-18");
});

test("birth age settings reject invalid configurations and unsupported question types", () => {
  for (const confirmAboveAgeYears of [-1, 6.5, "6", 121]) {
    const question = { ...birthQuestion, validation: { confirmAboveAgeYears } };
    assert.throws(() => validateDefinition({ title: "问卷", pages: [{ id: "p", questions: [question] }] }), /年龄确认/);
  }
  assert.throws(() => validateDefinition({ title: "问卷", pages: [{ id: "p", questions: [{ ...birthQuestion, type: "text" }] }] }), /年龄确认/);
});

test("server accepts confirmed older children and rejects future or impossible dates when bypassing the picker", () => {
  const definition = { title: "出生日期校验", pages: [{ id: "p", questions: [birthQuestion] }] };
  const survey = { id: "isolated-birth-validation", version: 1, definition };
  const { min, max } = getDatePartsBounds(birthQuestion);
  const input = (iso) => ({
    surveyVersion: 1, startedAt: new Date().toISOString(),
    answers: [{ questionId: "birth", type: "dateParts", ...dateAnswer(iso) }]
  });
  assert.equal(validateResponse(input(min), survey, false).answers[0].value.year, min.slice(0, 4));
  assert.equal(validateResponse(input(max), survey, false).metadata.storage, "server-sqlite");
  assert.ok(validateResponse(input("2018-01-01"), survey, false));
  for (const iso of ["1899-12-31", "2100-12-31", `${max.slice(0, 4)}-02-30`]) {
    assert.throws(() => validateResponse(input(iso), survey, false), error => error.status === 400 && Boolean(error.details?.birth));
  }
});

test("cascading hidden answers are pruned before dependent conditions are evaluated", () => {
  const survey = { pages: [{ id: "p", questions: [
    { id: "a", type: "singleChoice" },
    { id: "b", type: "text", visibleIf: { questionId: "a", operator: "equals", value: "yes" } },
    { id: "c", type: "text", visibleIf: { questionId: "b", operator: "answered" } }
  ] }] };
  assert.deepEqual(pruneHiddenAnswers(survey, { a: { value: "no" }, b: { value: "old" }, c: { value: "old dependent" } }), { a: { value: "no" } });
});

test("spreadsheet columns preserve duplicate titles, reserved headers and zero values", () => {
  const definition = { pages: [{ id: "p", questions: [
    { id: "q1", title: "同名题", type: "text" }, { id: "q2", title: "同名题", type: "rating" },
    { id: "q3", title: "答卷ID", type: "text" }
  ] }] };
  const row = { id: "row-id", response: { answers: [
    { questionId: "q1", value: "first" }, { questionId: "q2", value: 0 }, { questionId: "q3", value: "not-the-record-id" }
  ] } };
  const flat = flattenResponse(row, definition);
  assert.equal(flat["答卷ID"], "row-id");
  assert.equal(flat["同名题（q1）"], "first");
  assert.equal(flat["同名题（q2）"], 0);
  assert.equal(flat["答卷ID（q3）"], "not-the-record-id");
  assert.equal(formatAnswerValue({ value: 0 }, { type: "rating" }), 0);
});
