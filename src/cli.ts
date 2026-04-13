import { Command } from "commander";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGitAvailability, detectAuth } from "./auth.js";
import { loadConfig } from "./config.js";
import { GitHubClient } from "./github/client.js";
import { createLogger } from "./logging.js";
import { writeReports } from "./reporting/reporters.js";
import { promotePickNextCandidates, scorePullRequest } from "./scoring.js";
import { CliOptions, FetchRepoResult, FullReport, OwnershipMode, RepoRef, RunSummary } from "./types.js";
import {
  mapLimit,
  parseRepository,
  pathExists,
  readJsonFile,
  readTextFile,
  resolveFromBaseDir,
} from "./utils.js";

const PACKAGE_ROOT = findPackageRoot(dirname(fileURLToPath(import.meta.url)));

export function createProgram(): Command {
  return new Command()
    .name("prioritize-prs")
    .description("Scan a provided GitHub repository list and recommend an explainable PR review order.")
    .option("--repo <owner/repo>", "Repository to scan", collectOption, [])
    .option("--repos-file <path>", "Text or JSON file containing repositories")
    .option("--repos-csv <path>", "CSV file containing repositories")
    .option("--org <org>", "GitHub organization to search for CODEOWNERS matches")
    .option("--codeowners-team <team>", "Team slug or @org/team to match in CODEOWNERS files")
    .option("--codeowners-mode <mode>", "CODEOWNERS discovery mode: auto|search|deep", "auto")
    .option("--ownership-mode <mode>", "Ownership filter mode: assigned|touched|either|both", "either")
    .option("--include-archived", "Include archived repositories during CODEOWNERS discovery")
    .option("--only-with-open-prs", "After CODEOWNERS discovery, keep only repos with open PRs")
    .option("--repo-limit <number>", "Limit repositories inspected during CODEOWNERS discovery", parseOptionalInt)
    .option("--base-dir-file <path>", "File whose contents specify a base directory for resolving repo input files")
    .option("--repo-column <name>", "CSV column name to read repos from")
    .option("--output-dir <path>", "Directory for reports", "./out")
    .option("--format <format>", "Output format: json|md|csv|all", "all")
    .option("--max-prs-per-repo <number>", "Limit PRs fetched per repository", parseOptionalInt)
    .option("--exclude-drafts", "Exclude draft PRs")
    .option("--include-drafts", "Include draft PRs")
    .option("--base-branch <branch>", "Only scan PRs targeting this base branch")
    .option("--weights-file <path>", "Path to scoring weight overrides")
    .option("--org-affiliation-map <path>", "Path to username -> affiliation map")
    .option("--repo-business-weight <path>", "Path to repo -> strategic multiplier map")
    .option("--low-hanging-thresholds <path>", "Path to low-hanging-fruit thresholds")
    .option("--label-rules-file <path>", "Path to label interpretation rules")
    .option("--code-jam-thresholds-file <path>", "Path to code-jam suitability thresholds")
    .option("--verbose", "Enable verbose logging");
}

export function parseCliOptions(argv: string[]): CliOptions {
  const program = createProgram();
  program.parse(["node", "prioritize-prs", ...argv]);
  const rawOptions = program.opts();

  return {
    repos: rawOptions.repo ?? [],
    reposFile: rawOptions.reposFile,
    reposCsv: rawOptions.reposCsv,
    org: rawOptions.org,
    codeownersTeam: rawOptions.codeownersTeam,
    codeownersMode: parseCodeownersMode(rawOptions.codeownersMode),
    ownershipMode: parseOwnershipMode(rawOptions.ownershipMode),
    includeArchived: Boolean(rawOptions.includeArchived),
    onlyWithOpenPrs: Boolean(rawOptions.onlyWithOpenPrs),
    repoLimit: rawOptions.repoLimit,
    baseDirFile: rawOptions.baseDirFile,
    repoColumn: rawOptions.repoColumn,
    outputDir: rawOptions.outputDir,
    format: rawOptions.format,
    maxPrsPerRepo: rawOptions.maxPrsPerRepo,
    excludeDrafts: Boolean(rawOptions.excludeDrafts),
    includeDrafts: Boolean(rawOptions.includeDrafts),
    baseBranch: rawOptions.baseBranch,
    weightsFile: rawOptions.weightsFile,
    orgAffiliationMap: rawOptions.orgAffiliationMap,
    repoBusinessWeight: rawOptions.repoBusinessWeight,
    lowHangingThresholds: rawOptions.lowHangingThresholds,
    labelRulesFile: rawOptions.labelRulesFile,
    codeJamThresholdsFile: rawOptions.codeJamThresholdsFile,
    verbose: Boolean(rawOptions.verbose),
  };
}

export async function runCli(options: CliOptions): Promise<void> {
  const logger = createLogger(options.verbose);
  const normalizedOptions = await applyDefaultPaths(options);

  if (normalizedOptions.excludeDrafts && normalizedOptions.includeDrafts) {
    throw new Error("Choose only one of `--exclude-drafts` or `--include-drafts`.");
  }

  if ((normalizedOptions.org && !normalizedOptions.codeownersTeam) || (!normalizedOptions.org && normalizedOptions.codeownersTeam)) {
    throw new Error("Use `--org` and `--codeowners-team` together.");
  }

  const gitAvailable = await checkGitAvailability();
  if (!gitAvailable) {
    throw new Error("`git` is not available. Install Git and retry.");
  }

  const auth = await detectAuth(logger);
  logger.info(auth.label);

  const config = await loadConfig(normalizedOptions);
  const client = new GitHubClient({
    token: auth.token,
    logger,
    verbose: normalizedOptions.verbose,
  });
  const teamReviewContext =
    normalizedOptions.org && normalizedOptions.codeownersTeam
      ? await client.buildTeamReviewContext(normalizedOptions.org, normalizedOptions.codeownersTeam)
      : undefined;

  const repos = await loadRepositories(normalizedOptions, client, logger);
  if (repos.length === 0) {
    throw new Error(
      "No repositories were provided. Use `--repo`, `--repos-file`, `--repos-csv`, or `--org` with `--codeowners-team`, or place a default repo file in the project root.",
    );
  }

  logger.info(`Scanning ${repos.length} repo(s)...`);

  const results = await mapLimit(repos, 2, async (repo): Promise<FetchRepoResult> => {
    try {
      logger.verbose(`Checking access for ${repo.fullName}`);
      await client.validateRepoAccess(repo);
      const rawPrs = await client.fetchRepoAnalyses(repo, {
        maxPrsPerRepo: normalizedOptions.maxPrsPerRepo,
        baseBranch: normalizedOptions.baseBranch,
        includeDrafts: normalizedOptions.includeDrafts,
        excludeDrafts: normalizedOptions.excludeDrafts,
        affiliationMap: config.affiliationMap,
        teamReviewContext,
        ownershipMode: normalizedOptions.ownershipMode,
      });
      return { repo, pullRequests: rawPrs.map((pr) => scorePullRequest(pr, config)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`${repo.fullName}: ${message}`);
      return { repo, pullRequests: [], error: message };
    }
  });

  const reachableRepos = results.filter((result) => !result.error);
  const pullRequests = reachableRepos
    .flatMap((result) => result.pullRequests)
    .sort((left, right) => right.finalScore - left.finalScore);
  promotePickNextCandidates(pullRequests, config);
  const repoSummaries = reachableRepos
    .filter((result) => result.pullRequests.length > 0)
    .map((result) => summarizeRepo(result.repo.fullName, result.pullRequests, config));
  const recommendationGroups = {
    pickNext: pullRequests.filter((pr) => pr.recommendationBucket === "Pick Next"),
    quickWins: pullRequests.filter((pr) => pr.recommendationBucket === "Quick Wins"),
    importantButHeavy: pullRequests.filter((pr) => pr.recommendationBucket === "Important but Heavy"),
    needsClarification: pullRequests.filter((pr) => pr.recommendationBucket === "Needs Clarification"),
    probablyDeprioritize: pullRequests.filter(
      (pr) => pr.recommendationBucket === "Probably Deprioritize for Code Jam",
    ),
  };
  const summary: RunSummary = {
    scannedRepos: repos.length,
    reachableRepos: reachableRepos.length,
    totalPrs: pullRequests.length,
    pickNextCount: pullRequests.filter((pr) => pr.recommendationBucket === "Pick Next").length,
    quickWinsCount: pullRequests.filter((pr) => pr.recommendationBucket === "Quick Wins").length,
    importantButHeavyCount: pullRequests.filter((pr) => pr.recommendationBucket === "Important but Heavy").length,
    needsClarificationCount: pullRequests.filter((pr) => pr.recommendationBucket === "Needs Clarification").length,
    deprioritizeCount: pullRequests.filter((pr) => pr.recommendationBucket === "Probably Deprioritize for Code Jam").length,
    lowHangingFruitCount: pullRequests.filter((pr) => pr.lowHangingFruit).length,
    partialFailures: results
      .filter((result) => result.error)
      .map((result) => ({ repo: result.repo.fullName, error: result.error ?? "Unknown error" })),
    authModeLabel: auth.label,
  };

  const caveats = [
    "These rankings are recommendations, not source-of-truth business decisions.",
    "Human review is expected before scheduling or merging work.",
    "Some signals are inferential and may be incomplete, especially when issue, stakeholder, or affiliation context is sparse.",
  ];

  if (summary.totalPrs === 0 && summary.partialFailures.length > 0) {
    caveats.unshift("No PRs were fully analyzed in this run because partial failures interrupted collection.");
    caveats.unshift("This report is incomplete. Rerun after the GitHub rate limit resets to get a meaningful ranking.");
  } else if (summary.totalPrs === 0) {
    caveats.unshift("No PRs matched the current filters or ownership criteria in this run.");
  }

  const report: FullReport = {
    generatedAt: new Date().toISOString(),
    summary,
    recommendationGroups,
    repoSummaries,
    pullRequests,
    caveats,
  };

  const writtenFiles = await writeReports(
    report,
    resolve(normalizedOptions.outputDir),
    normalizedOptions.format,
  );
  printStdoutSummary(summary, writtenFiles);
}

export async function applyDefaultPaths(options: CliOptions): Promise<CliOptions> {
  const hasExplicitRepoInput =
    options.repos.length > 0 ||
    Boolean(options.reposFile) ||
    Boolean(options.reposCsv) ||
    Boolean(options.org && options.codeownersTeam);
  const defaultBaseDirFile = await detectFirstExisting([packagePath("defaults/base-dir.txt"), "./base-dir.txt"]);
  const usingDefaultsBaseDir = defaultBaseDirFile === packagePath("defaults/base-dir.txt");
  const packagedDefaultsDir = packagePath("defaults");

  return {
    ...options,
    reposFile:
      options.reposFile ??
      (hasExplicitRepoInput
        ? undefined
        :
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "repos.txt"), resolve(packagedDefaultsDir, "repos.json")]
          : [packagePath("defaults/repos.txt"), packagePath("defaults/repos.json"), "./repos.txt", "./repos.json"],
      ))),
    reposCsv:
      options.reposCsv ??
      (hasExplicitRepoInput
        ? undefined
        :
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "repos.csv")]
          : [packagePath("defaults/repos.csv"), "./repos.csv"],
      ))),
    baseDirFile: options.baseDirFile ?? (hasExplicitRepoInput ? undefined : defaultBaseDirFile),
    weightsFile:
      options.weightsFile ??
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "weights.json")]
          : [packagePath("defaults/weights.json"), "./weights.json"],
      )),
    orgAffiliationMap:
      options.orgAffiliationMap ??
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "affiliations.json")]
          : [packagePath("defaults/affiliations.json"), "./affiliations.json"],
      )),
    repoBusinessWeight:
      options.repoBusinessWeight ??
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "repo_weights.json")]
          : [packagePath("defaults/repo_weights.json"), "./repo_weights.json"],
      )),
    lowHangingThresholds:
      options.lowHangingThresholds ??
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "low_hanging_thresholds.json")]
          : [packagePath("defaults/low_hanging_thresholds.json"), "./low_hanging_thresholds.json"],
      )),
    labelRulesFile:
      options.labelRulesFile ??
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "label_rules.json")]
          : [packagePath("defaults/label_rules.json"), "./label_rules.json"],
      )),
    codeJamThresholdsFile:
      options.codeJamThresholdsFile ??
      (await detectFirstExisting(
        usingDefaultsBaseDir
          ? [resolve(packagedDefaultsDir, "code_jam_thresholds.json")]
          : [packagePath("defaults/code_jam_thresholds.json"), "./code_jam_thresholds.json"],
      )),
  };
}

export async function detectFirstExisting(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function loadRepositories(
  options: CliOptions,
  client: GitHubClient,
  logger: ReturnType<typeof createLogger>,
): Promise<RepoRef[]> {
  if (options.org && options.codeownersTeam) {
    logger.info(`Discovering repos in ${options.org} from CODEOWNERS entries for ${options.codeownersTeam}...`);
    return client.discoverReposByCodeowners(options.org, options.codeownersTeam, {
      mode: options.codeownersMode,
      includeArchived: options.includeArchived,
      onlyWithOpenPrs: options.onlyWithOpenPrs,
      baseBranch: options.baseBranch,
      repoLimit: options.repoLimit,
    });
  }

  const refs = [...options.repos];
  const baseDir = options.baseDirFile ? await loadBaseDir(options.baseDirFile) : undefined;

  if (options.reposFile) {
    const reposFile = resolveInputPath(options.reposFile, baseDir);
    if (reposFile.toLowerCase().endsWith(".json")) {
      const jsonRepos = await readJsonFile<string[]>(reposFile);
      refs.push(...jsonRepos);
    } else {
      const text = await readTextFile(reposFile);
      refs.push(
        ...text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
      );
    }
  }

  if (options.reposCsv) {
    const reposCsv = resolveInputPath(options.reposCsv, baseDir);
    const csvText = await readTextFile(reposCsv);
    refs.push(...parseRepositoriesFromCsv(csvText, options.repoColumn));
  }

  const seen = new Set<string>();
  return refs.map(parseRepository).filter((repo) => {
    if (seen.has(repo.fullName)) {
      return false;
    }
    seen.add(repo.fullName);
    return true;
  });
}

export async function loadBaseDir(baseDirFile: string): Promise<string> {
  const contents = await readTextFile(baseDirFile);
  const baseDir = contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));

  if (!baseDir) {
    throw new Error(`Base directory file "${baseDirFile}" did not contain a usable path.`);
  }

  return resolve(dirname(resolve(baseDirFile)), baseDir);
}

export function resolveInputPath(inputPath: string, baseDir?: string): string {
  return baseDir ? resolveFromBaseDir(baseDir, inputPath) : resolve(inputPath);
}

export function parseRepositoriesFromCsv(csvText: string, preferredColumn?: string): string[] {
  const rows = parseCsvRows(csvText).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) {
    return [];
  }

  const [headerRow, ...dataRows] = rows;
  const header = (headerRow ?? []).map((cell) => cell.trim());
  const normalizedHeader = header.map((cell) => cell.toLowerCase());
  const candidateColumns = [
    preferredColumn?.toLowerCase(),
    "repo",
    "repository",
    "full_name",
    "full name",
    "name",
  ].filter((value): value is string => Boolean(value));

  let repoColumnIndex = normalizedHeader.findIndex((name) => candidateColumns.includes(name));
  if (repoColumnIndex < 0) {
    repoColumnIndex = 0;
  }

  return dataRows
    .map((row) => row[repoColumnIndex]?.trim() ?? "")
    .filter((value) => value.length > 0 && !value.startsWith("#"));
}

export function parseCsvRows(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function summarizeRepo(
  repo: string,
  pullRequests: FullReport["pullRequests"],
  config: Awaited<ReturnType<typeof loadConfig>>,
): FullReport["repoSummaries"][number] {
  const sorted = [...pullRequests].sort((left, right) => right.finalScore - left.finalScore);
  const top = sorted[0];
  return {
    repo,
    totalOpenPrs: pullRequests.length,
    highScorePrs: pullRequests.filter((pr) => pr.finalScore >= config.codeJamThresholds.highScoreThreshold).length,
    stalePrs: pullRequests.filter(
      (pr) =>
        pr.ageDays > config.codeJamThresholds.stalePrAgeDays &&
        pr.daysSinceLastUpdate > config.codeJamThresholds.stalePrIdleDays,
    ).length,
    lowHangingFruitPrs: pullRequests.filter((pr) => pr.lowHangingFruit).length,
    quickWinsPrs: pullRequests.filter((pr) => pr.recommendationBucket === "Quick Wins").length,
    pickNextPrs: pullRequests.filter((pr) => pr.recommendationBucket === "Pick Next").length,
    recommendedTopPr: top
      ? {
          number: top.number,
          title: top.title,
          url: top.url,
          score: top.finalScore,
        }
      : undefined,
  };
}

function printStdoutSummary(summary: RunSummary, writtenFiles: string[]): void {
  console.log(`scanned ${summary.scannedRepos} repos`);
  console.log(`found ${summary.totalPrs} open PRs`);
  console.log(`${summary.pickNextCount} marked as likely \`pick-next\``);
  console.log(`${summary.lowHangingFruitCount} low-hanging-fruit candidates`);
  console.log(`${summary.importantButHeavyCount} high-value but heavy PRs`);
  console.log(`reports written to ${writtenFiles.join(", ")}`);
  if (summary.partialFailures.length > 0) {
    console.log(`${summary.partialFailures.length} repos had partial failures`);
  }
}

// ---------------------------------------------------------------------------
// list-repos subcommand
// ---------------------------------------------------------------------------

interface ListReposOptions {
  org: string;
  codeownersTeam: string;
  codeownersMode: CliOptions["codeownersMode"];
  includeArchived: boolean;
  onlyWithOpenPrs: boolean;
  repoLimit?: number;
  format: "text" | "json" | "csv";
  output?: string;
  verbose: boolean;
}

export function parseListReposOptions(argv: string[]): ListReposOptions {
  const program = new Command()
    .name("list-repos")
    .description("List repositories owned by a CODEOWNERS team.")
    .requiredOption("--org <org>", "GitHub organization")
    .requiredOption("--codeowners-team <team>", "Team slug or @org/team to match in CODEOWNERS files")
    .option("--codeowners-mode <mode>", "CODEOWNERS discovery mode: auto|search|deep", "auto")
    .option("--include-archived", "Include archived repositories")
    .option("--only-with-open-prs", "Filter to repositories with open PRs")
    .option("--repo-limit <number>", "Limit repositories inspected during discovery", parseOptionalInt)
    .option("--format <format>", "Output format: text|json|csv", "text")
    .option("--output <file>", "Write output to a file instead of stdout")
    .option("--verbose", "Enable verbose logging");

  program.parse(["node", "list-repos", ...argv]);
  const raw = program.opts();

  return {
    org: raw.org as string,
    codeownersTeam: raw.codeownersTeam as string,
    codeownersMode: parseCodeownersMode(raw.codeownersMode as string),
    includeArchived: Boolean(raw.includeArchived),
    onlyWithOpenPrs: Boolean(raw.onlyWithOpenPrs),
    repoLimit: raw.repoLimit,
    format: parseListReposFormat(raw.format as string),
    output: raw.output,
    verbose: Boolean(raw.verbose),
  };
}

export async function runListRepos(options: ListReposOptions): Promise<void> {
  const logger = createLogger(options.verbose);

  const gitAvailable = await checkGitAvailability();
  if (!gitAvailable) {
    throw new Error("`git` is not available. Install Git and retry.");
  }

  const auth = await detectAuth(logger);
  logger.info(auth.label);

  const client = new GitHubClient({
    token: auth.token,
    logger,
    verbose: options.verbose,
  });

  logger.info(`Discovering repos in ${options.org} owned by ${options.codeownersTeam}...`);
  const repos = await client.discoverReposByCodeowners(options.org, options.codeownersTeam, {
    mode: options.codeownersMode,
    includeArchived: options.includeArchived,
    onlyWithOpenPrs: options.onlyWithOpenPrs,
    repoLimit: options.repoLimit,
  });

  const output = formatRepoList(repos, options.format);

  if (options.output) {
    await writeFile(options.output, output, "utf8");
    console.log(`wrote ${repos.length} repo(s) to ${options.output}`);
  } else {
    if (output.length > 0) {
      console.log(output);
    }
    console.error(`found ${repos.length} repo(s)`);
  }
}

function parseListReposFormat(value: string): "text" | "json" | "csv" {
  if (value === "text" || value === "json" || value === "csv") {
    return value;
  }
  throw new Error(`Expected --format to be one of text, json, csv but received "${value}"`);
}

function formatRepoList(repos: RepoRef[], format: "text" | "json" | "csv"): string {
  if (repos.length === 0) {
    return "";
  }
  if (format === "json") {
    return JSON.stringify(repos, null, 2);
  }
  if (format === "csv") {
    const rows = ["owner,repo,fullName", ...repos.map((r) => `${r.owner},${r.repo},${r.fullName}`)];
    return rows.join("\n");
  }
  return repos.map((r) => r.fullName).join("\n");
}

function collectOption(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

export function parseOptionalInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer but received "${value}"`);
  }
  return parsed;
}

export function parseCodeownersMode(value: string): CliOptions["codeownersMode"] {
  if (value === "auto" || value === "search" || value === "deep") {
    return value;
  }
  throw new Error(`Expected --codeowners-mode to be one of auto, search, or deep but received "${value}"`);
}

export function parseOwnershipMode(value: string): OwnershipMode {
  if (value === "assigned" || value === "touched" || value === "either" || value === "both") {
    return value;
  }
  throw new Error(`Expected --ownership-mode to be one of assigned, touched, either, or both but received "${value}"`);
}

function packagePath(relativePath: string): string {
  return resolve(PACKAGE_ROOT, relativePath);
}

function findPackageRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    if (existsSync(resolve(current, "package.json"))) {
      return current;
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      return startDir;
    }
    current = parent;
  }
}
