import { chmodSync, existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { backup } from "node:sqlite";

export async function createBackup(db, output) {
  if (existsSync(output)) throw new Error("备份目标已存在，不会覆盖已有文件");
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  await backup(db, output);
  chmodSync(output, 0o600);
  return output;
}

export function pruneBackups(directory, keep) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error("保留份数必须为正整数");
  const files = readdirSync(directory).filter((name) => /^survey-\d{8}T\d{9}Z\.sqlite$/.test(name)).sort().reverse();
  for (const file of files.slice(keep)) unlinkSync(join(directory, file));
}

export function backupName() {
  return `survey-${new Date().toISOString().replace(/[-:.]/g, "")}.sqlite`;
}
