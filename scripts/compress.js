import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

async function compress(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await compress(path);
    else if (/\.(js|css|html|svg|json)$/.test(entry.name)) {
      const data = await readFile(path);
      if (data.length < 512) continue;
      await writeFile(path + ".gz", gzipSync(data, { level: 9 }));
      await writeFile(path + ".br", brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
    }
  }
}
await compress(fileURLToPath(new URL("../dist/", import.meta.url)));
console.log("Static gzip / Brotli assets ready");
