import { createServer } from "node:http";
import { createApplication } from "./app.js";
import { getConfig, loadEnvironment } from "./config.js";
import { openDatabase } from "./database.js";

process.umask(0o077);
loadEnvironment();
const config = getConfig();
const db = openDatabase(config.dbPath);
const server = createServer({ maxHeaderSize: 16384 }, createApplication({ db, config }));
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.listen(config.port, config.host, () => console.log("Survey service ready (SQLite persistence enabled)"));
server.on("error", (error) => {
  console.error("Unable to start survey service:", error.code || error.name);
  db.close();
  process.exitCode = 1;
});
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => { db.close(); });
  setTimeout(() => { server.closeAllConnections(); }, 10000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
