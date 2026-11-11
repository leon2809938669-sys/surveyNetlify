import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { backupName, createBackup, pruneBackups } from "./backups.js";
import { loadEnvironment, projectRoot } from "./config.js";
import { exportSnapshot, importSnapshot, openDatabase } from "./database.js";

process.umask(0o077);
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    database: { type: "string" }, "env-file": { type: "string" }, input: { type: "string" },
    surveys: { type: "string" }, responses: { type: "string" }, output: { type: "string" },
    "output-dir": { type: "string" }, "dry-run": { type: "boolean", default: false }, keep: { type: "string" }
  }
});
const [command] = positionals;
if (!["import", "import-supabase", "export", "backup", "verify"].includes(command)) {
  console.log(`Usage: npm run data -- <command> [options]
  import --input private-backup.json [--dry-run]
  import --surveys surveys.json --responses survey_responses.json [--dry-run]
  import-supabase --env-file private-source.env [--output private-snapshot.json] [--dry-run]
  export --output private-backup.json
  backup [--output-dir private-backups] [--keep 30]
  verify
Common: --database path/to/survey.sqlite; --env-file path/to/private.env
Imports preserve IDs, versions, JSON and timestamps; existing IDs are never overwritten.`);
  process.exitCode = command ? 1 : 0;
} else {
  let db;
  try {
    loadEnvironment(values["env-file"]);
    const database = resolve(values.database || process.env.SURVEY_DB_PATH || join(projectRoot, ".data/survey.sqlite"));
    db = openDatabase(database);
    const readJson = (file) => JSON.parse(readFileSync(resolve(file), "utf8"));
    const saveJson = (file, data) => {
      const output = resolve(file);
      mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
      writeFileSync(output, JSON.stringify(data, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    };
    if (command === "import" || command === "import-supabase") {
      let snapshot;
      if (command === "import-supabase") {
        snapshot = await readSupabaseSnapshot();
        if (values.output) saveJson(values.output, snapshot);
      } else if (values.input) snapshot = readJson(values.input);
      else if (values.surveys && values.responses) snapshot = { surveys: readJson(values.surveys), survey_responses: readJson(values.responses) };
      else throw new Error("请提供 --input，或同时提供 --surveys 和 --responses");
      // Always make a consistent SQLite backup before writing to a non-empty database.
      if (!values["dry-run"] && db.prepare("SELECT COUNT(*) AS count FROM surveys").get().count) {
        await createBackup(db, join(dirname(database), "backups", backupName()));
      }
      console.log(JSON.stringify(importSnapshot(db, snapshot, { dryRun: values["dry-run"] })));
    } else if (command === "export") {
      if (!values.output) throw new Error("请指定 --output（建议使用仓库外的安全目录）");
      const snapshot = exportSnapshot(db);
      saveJson(values.output, snapshot);
      console.log(JSON.stringify({ ok: true, surveys: snapshot.surveys.length, responses: snapshot.survey_responses.length }));
    } else if (command === "backup") {
      const directory = resolve(values["output-dir"] || join(dirname(database), "backups"));
      const keep = values.keep === undefined ? null : Number(values.keep);
      if (keep !== null && (!Number.isInteger(keep) || keep < 1)) throw new Error("--keep 必须为正整数");
      await createBackup(db, join(directory, backupName()));
      if (keep !== null) pruneBackups(directory, keep);
      console.log(JSON.stringify({ ok: true, backupCreated: true }));
    } else {
      const integrity = db.prepare("PRAGMA integrity_check").all();
      const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
      if (integrity.some((row) => row.integrity_check !== "ok") || foreignKeys.length) throw new Error("数据库完整性检查未通过");
      console.log(JSON.stringify({ ok: true, integrity: "ok", surveys: db.prepare("SELECT COUNT(*) AS count FROM surveys").get().count,
        responses: db.prepare("SELECT COUNT(*) AS count FROM survey_responses").get().count }));
    }
  } catch (error) {
    // Do not print URLs, credentials, query results, or whole exception objects.
    const message = error.code?.startsWith("SQLITE") ? "数据库约束检查失败；本次导入已回滚，请检查数据格式及关联记录" : error.message;
    console.error(message?.includes("supabase.co") ? "无法连接源数据库，请检查网络和源凭证" : message);
    process.exitCode = 1;
  } finally { db?.close(); }
}

async function readSupabaseSnapshot() {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("导入工具需要源 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY（仅迁移使用）");
  const origin = new URL(base);
  if (origin.protocol !== "https:") throw new Error("源数据库必须使用 HTTPS");
  async function readTable(table) {
    const rows = [];
    const seen = new Set();
    let total;
    while (total === undefined || rows.length < total) {
      const url = new URL(`/rest/v1/${table}`, origin);
      url.search = new URLSearchParams({ select: "*", order: "id.asc", limit: "1000", offset: String(rows.length) }).toString();
      let response;
      try {
        response = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" }, signal: AbortSignal.timeout(30000) });
      } catch { throw new Error("无法连接源数据库，请检查网络或项目是否暂停"); }
      if (!response.ok) throw new Error(`读取源数据失败（HTTP ${response.status}），未写入目标数据库`);
      const page = await response.json();
      if (!Array.isArray(page)) throw new Error("源数据库未返回记录数组");
      const match = response.headers.get("content-range")?.match(/\/(\d+)$/);
      if (match) total = Number(match[1]);
      if (!page.length) {
        if (total !== undefined && rows.length < total) throw new Error("源数据库分页数量不一致，请稍后重试");
        break;
      }
      for (const row of page) {
        if (seen.has(row.id)) throw new Error("源数据分页发生重复，请暂停旧站写入后重试");
        seen.add(row.id);
        rows.push(row);
      }
    }
    return rows;
  }
  const surveys = await readTable("surveys");
  const responses = await readTable("survey_responses");
  return { schema: "survey-backup.v1", exportedAt: new Date().toISOString(), surveys, survey_responses: responses };
}
