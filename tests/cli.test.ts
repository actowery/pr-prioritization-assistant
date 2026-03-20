import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = resolve(process.cwd());
const cliEntry = resolve(projectRoot, "dist", "index.js");

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliEntry, ...args], {
      cwd: projectRoot,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolvePromise({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

test("cli help exposes the codeowners options", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /--codeowners-mode <mode>/);
  assert.match(result.stdout, /--only-with-open-prs/);
});

test("cli rejects invalid codeowners mode before any network work", async () => {
  const result = await runCli(["--codeowners-mode", "invalid"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[error\] Expected --codeowners-mode to be one of auto, search, or deep/);
});

test("cli rejects invalid ownership mode before any network work", async () => {
  const result = await runCli(["--ownership-mode", "invalid"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[error\] Expected --ownership-mode to be one of assigned, touched, either, or both/);
});

test("cli rejects org without codeowners team", async () => {
  const result = await runCli(["--org", "exampleorg"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[error\] Use `--org` and `--codeowners-team` together\./);
});

test("cli rejects conflicting draft flags", async () => {
  const result = await runCli(["--exclude-drafts", "--include-drafts"]);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /\[error\] Choose only one of `--exclude-drafts` or `--include-drafts`\./);
});
