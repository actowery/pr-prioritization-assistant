import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const reportsOnly = process.argv.includes("--reports-only");
const cwd = process.cwd();
const entries = await readdir(cwd, { withFileTypes: true });

const targets = new Set(["out"]);
if (!reportsOnly) {
  targets.add("dist");
  targets.add("dist-tests");
}

for (const entry of entries) {
  if (!entry.isDirectory()) {
    continue;
  }

  if (targets.has(entry.name) || /^out-[A-Za-z0-9_-]+$/.test(entry.name)) {
    await rm(join(cwd, entry.name), { recursive: true, force: true });
    console.log(`removed ${entry.name}`);
  }
}
