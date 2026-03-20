import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const testsDir = resolve(process.cwd(), "dist-tests", "tests");
const entries = await readdir(testsDir, { withFileTypes: true });
const testFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.js"))
  .map((entry) => join(testsDir, entry.name))
  .sort();

if (testFiles.length === 0) {
  console.error("No compiled test files were found in dist-tests/tests.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...testFiles], {
  stdio: "inherit",
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
