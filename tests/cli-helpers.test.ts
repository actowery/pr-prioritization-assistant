import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  applyDefaultPaths,
  loadBaseDir,
  parseCliOptions,
  parseCodeownersMode,
  parseCsvRows,
  parseOptionalInt,
  parseRepositoriesFromCsv,
  resolveInputPath,
} from "../src/cli.js";
import { CliOptions } from "../src/types.js";

function makeOptions(overrides: Partial<CliOptions> = {}): CliOptions {
  return {
    repos: [],
    reposFile: undefined,
    reposCsv: undefined,
    org: undefined,
    codeownersTeam: undefined,
    codeownersMode: "auto",
    ownershipMode: "either",
    includeArchived: false,
    onlyWithOpenPrs: false,
    repoLimit: undefined,
    baseDirFile: undefined,
    repoColumn: undefined,
    outputDir: "./out",
    format: "all",
    maxPrsPerRepo: undefined,
    excludeDrafts: false,
    includeDrafts: false,
    baseBranch: undefined,
    weightsFile: undefined,
    orgAffiliationMap: undefined,
    repoBusinessWeight: undefined,
    lowHangingThresholds: undefined,
    labelRulesFile: undefined,
    codeJamThresholdsFile: undefined,
    verbose: false,
    ...overrides,
  };
}

test("parseCliOptions reads codeowners flags and booleans", () => {
  const parsed = parseCliOptions([
    "--org",
    "exampleorg",
    "--codeowners-team",
    "@exampleorg/platform-core",
    "--codeowners-mode",
    "search",
    "--ownership-mode",
    "both",
    "--only-with-open-prs",
    "--include-archived",
    "--repo-limit",
    "25",
  ]);

  assert.equal(parsed.org, "exampleorg");
  assert.equal(parsed.codeownersTeam, "@exampleorg/platform-core");
  assert.equal(parsed.codeownersMode, "search");
  assert.equal(parsed.ownershipMode, "both");
  assert.equal(parsed.onlyWithOpenPrs, true);
  assert.equal(parsed.includeArchived, true);
  assert.equal(parsed.repoLimit, 25);
});

test("parseCodeownersMode rejects invalid values", () => {
  assert.throws(() => parseCodeownersMode("weird"), /auto, search, or deep/);
});

test("parseOptionalInt rejects non-positive values", () => {
  assert.throws(() => parseOptionalInt("0"), /positive integer/);
  assert.throws(() => parseOptionalInt("abc"), /positive integer/);
});

test("parseCsvRows handles quoted values and parseRepositoriesFromCsv ignores commented rows", () => {
  const csv = [
    'repo,name,notes',
    '"owner/repo-one","repo-one","hello, world"',
    '# ignored,row,here',
    '"owner/repo-two","repo-two","line ""quoted"""',
  ].join("\n");

  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 4);

  const repos = parseRepositoriesFromCsv(csv, "repo");
  assert.deepEqual(repos, ["owner/repo-one", "owner/repo-two"]);
});

test("loadBaseDir and resolveInputPath resolve relative paths from the base dir file", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pr-pri-base-"));
  const nestedDir = join(tempDir, "configs");
  const baseDirFile = join(nestedDir, "base-dir.txt");

  await mkdir(nestedDir, { recursive: true });
  await writeFile(baseDirFile, "../workspace\n", "utf8");

  const baseDir = await loadBaseDir(baseDirFile);
  assert.equal(baseDir, resolve(tempDir, "workspace"));
  assert.equal(resolveInputPath("repos.csv", baseDir), resolve(tempDir, "workspace", "repos.csv"));
});

test("applyDefaultPaths keeps explicit repo input from pulling in default repo files", async () => {
  const applied = await applyDefaultPaths(
    makeOptions({
      repos: ["owner/repo"],
    }),
  );

  assert.equal(applied.reposFile, undefined);
  assert.equal(applied.reposCsv, undefined);
  assert.equal(applied.baseDirFile, undefined);
});

test("applyDefaultPaths discovers packaged defaults when no explicit repo input is supplied", async () => {
  const applied = await applyDefaultPaths(makeOptions());

  assert.match(applied.baseDirFile ?? "", /defaults[\\/]+base-dir\.txt$/);
  assert.match(applied.reposCsv ?? "", /defaults[\\/]+repos\.csv$/);
  assert.match(applied.orgAffiliationMap ?? "", /defaults[\\/]+affiliations\.json$/);
});
