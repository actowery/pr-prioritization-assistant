import { join } from "node:path";
import { FullReport, OutputFormat, PullRequestAnalysis } from "../types.js";
import { csvEscape, ensureDir, writeTextFile } from "../utils.js";

export async function writeReports(
  report: FullReport,
  outputDir: string,
  format: OutputFormat,
): Promise<string[]> {
  await ensureDir(outputDir);
  const writtenFiles: string[] = [];

  if (format === "all" || format === "json") {
    const path = join(outputDir, "pr-priorities.json");
    await writeTextFile(path, `${JSON.stringify(report, null, 2)}\n`);
    writtenFiles.push(path);
  }

  if (format === "all" || format === "md") {
    const path = join(outputDir, "pr-priorities.md");
    await writeTextFile(path, renderMarkdown(report));
    writtenFiles.push(path);
  }

  if (format === "all" || format === "csv") {
    const path = join(outputDir, "pr-priorities.csv");
    await writeTextFile(path, renderCsv(report.pullRequests));
    writtenFiles.push(path);
  }

  return writtenFiles;
}

export function renderMarkdown(report: FullReport): string {
  const lines: string[] = [];
  lines.push("# PR Prioritization Assistant Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Authentication mode: ${report.summary.authModeLabel}`);
  lines.push(`- Repos scanned: ${report.summary.scannedRepos}`);
  lines.push(`- Reachable repos: ${report.summary.reachableRepos}`);
  lines.push(`- Open PRs analyzed: ${report.summary.totalPrs}`);
  lines.push(`- Pick Next: ${report.summary.pickNextCount}`);
  lines.push(`- Quick Wins: ${report.summary.quickWinsCount}`);
  lines.push(`- Important but Heavy: ${report.summary.importantButHeavyCount}`);
  lines.push(`- Needs Clarification: ${report.summary.needsClarificationCount}`);
  lines.push(`- Probably Deprioritize for Code Jam: ${report.summary.deprioritizeCount}`);
  lines.push(`- Low-hanging-fruit candidates: ${report.summary.lowHangingFruitCount}`);
  if (report.pullRequests.length === 0 && report.summary.partialFailures.length > 0) {
    lines.push(`- Run quality: incomplete due to partial failures or rate limiting`);
  } else if (report.pullRequests.length === 0) {
    lines.push(`- Run quality: no PRs matched the current filters`);
  }

  if (report.summary.partialFailures.length > 0) {
    lines.push("");
    lines.push("## Partial Failures");
    lines.push("");
    for (const failure of report.summary.partialFailures) {
      lines.push(`- ${failure.repo}: ${failure.error}`);
    }
  }

  lines.push("");
  lines.push("## Top Recommendations");
  lines.push("");
  if (report.pullRequests.length === 0) {
    lines.push("No PRs were available to rank in this run.");
    lines.push("");
  }
  for (const pr of report.pullRequests.slice(0, 10)) {
    appendPrDetail(lines, pr);
  }

  lines.push("## Recommendation Buckets");
  lines.push("");
  appendBucket(lines, "Pick Next", report.recommendationGroups.pickNext);
  appendBucket(lines, "Quick Wins", report.recommendationGroups.quickWins);
  appendBucket(lines, "Important but Heavy", report.recommendationGroups.importantButHeavy);
  appendBucket(lines, "Needs Clarification", report.recommendationGroups.needsClarification);
  appendBucket(lines, "Probably Deprioritize for Code Jam", report.recommendationGroups.probablyDeprioritize);

  lines.push("## Repo Summaries");
  lines.push("");
  if (report.repoSummaries.length === 0) {
    lines.push("No repos produced analyzable PRs in this run.");
    lines.push("");
  }
  for (const repoSummary of report.repoSummaries) {
    lines.push(`### ${repoSummary.repo}`);
    lines.push("");
    lines.push(`- Total open PR count: ${repoSummary.totalOpenPrs}`);
    lines.push(`- High-score PRs: ${repoSummary.highScorePrs}`);
    lines.push(`- Pick Next PRs: ${repoSummary.pickNextPrs}`);
    lines.push(`- Quick Wins PRs: ${repoSummary.quickWinsPrs}`);
    lines.push(`- Stale PRs: ${repoSummary.stalePrs}`);
    lines.push(`- Low-hanging-fruit PRs: ${repoSummary.lowHangingFruitPrs}`);
    lines.push(
      `- Recommended top PR: ${
        repoSummary.recommendedTopPr
          ? `#${repoSummary.recommendedTopPr.number} ${repoSummary.recommendedTopPr.title} (${repoSummary.recommendedTopPr.score.toFixed(2)})`
          : "none"
      }`,
    );
    lines.push("");
  }

  lines.push("## Confidence and Caveats");
  lines.push("");
  for (const caveat of report.caveats) {
    lines.push(`- ${caveat}`);
  }

  lines.push("");
  lines.push("## Full Ranked Table");
  lines.push("");
  lines.push("| Rank | Repo | PR | Title | Score | Bucket | Merge Ready | Low Hanging | Tags |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  report.pullRequests.forEach((pr, index) => {
    lines.push(
      `| ${index + 1} | ${pr.repo} | #${pr.number} | ${sanitizeTableCell(pr.title)} | ${pr.finalScore.toFixed(2)} | ${pr.recommendationBucket} | ${pr.mergeReadinessScore >= 7 ? "yes" : "no"} | ${pr.lowHangingFruit ? "yes" : "no"} | ${sanitizeTableCell(pr.tags.join(", "))} |`,
    );
  });

  return `${lines.join("\n")}\n`;
}

function appendPrDetail(lines: string[], pr: PullRequestAnalysis): void {
  lines.push(`### ${pr.repo} #${pr.number} - ${pr.title}`);
  lines.push("");
  lines.push(`- Rank score: ${pr.finalScore.toFixed(2)}`);
  lines.push(`- Bucket: ${pr.recommendationBucket}`);
  lines.push(`- Tags: ${pr.tags.join(", ") || "none"}`);
  lines.push(`- Author: ${pr.author}`);
  lines.push(`- URL: ${pr.url}`);
  lines.push(`- Ownership match: ${pr.ownershipMatch}`);
  lines.push(`- Change size: ${pr.changedLines} lines across ${pr.changedFiles} files`);
  lines.push(
    `- Score breakdown: business ${pr.businessRelevanceScore}, unblock ${pr.unblockValueScore}, readiness ${pr.mergeReadinessScore}, effort ${pr.effortReviewCostScore}, staleness ${pr.stalenessSignalScore}, community ${pr.communityValueScore}`,
  );
  lines.push("- Explanation:");
  for (const explanation of pr.explanation) {
    lines.push(`  - ${explanation}`);
  }
  if (pr.caveats.length > 0) {
    lines.push("- Caveats:");
    for (const caveat of pr.caveats) {
      lines.push(`  - ${caveat}`);
    }
  }
  lines.push("");
}

function appendBucket(lines: string[], title: string, pullRequests: PullRequestAnalysis[]): void {
  lines.push(`### ${title}`);
  lines.push("");
  if (pullRequests.length === 0) {
    lines.push("- None identified in this run.");
    lines.push("");
    return;
  }
  for (const pr of pullRequests.slice(0, 8)) {
    lines.push(`- ${pr.repo} #${pr.number}: ${pr.title} (${pr.finalScore.toFixed(2)})`);
    lines.push(`  Caveat: ${pr.caveats[0] ?? "No major caveat surfaced."}`);
  }
  lines.push("");
}

function renderCsv(pullRequests: PullRequestAnalysis[]): string {
  const headers = [
    "rank",
    "repo",
    "pr_number",
    "title",
    "url",
    "author",
    "age_days",
    "changed_lines",
    "changed_files",
    "issue_comments",
    "review_comments",
    "ownership_match",
    "requested_review_teams",
    "requested_review_users",
    "merge_readiness_score",
    "business_relevance_score",
    "unblock_value_score",
    "effort_review_cost_score",
    "staleness_signal_score",
    "community_value_score",
    "repo_multiplier",
    "final_score",
    "recommendation_bucket",
    "confidence",
    "tags",
    "explanation",
    "caveats",
    "low_hanging_fruit",
    "business_signals",
    "dependency_signals",
  ];
  const rows = [headers.join(",")];
  pullRequests.forEach((pr, index) => {
    rows.push(
      [
        index + 1,
        csvEscape(pr.repo),
        pr.number,
        csvEscape(pr.title),
        csvEscape(pr.url),
        csvEscape(pr.author),
        pr.ageDays,
        pr.changedLines,
        pr.changedFiles,
        pr.issueCommentCount,
        pr.reviewCommentCount,
        csvEscape(pr.ownershipMatch),
        csvEscape(pr.requestedReviewTeams.join("|")),
        csvEscape(pr.reviewRequests.join("|")),
        pr.mergeReadinessScore,
        pr.businessRelevanceScore,
        pr.unblockValueScore,
        pr.effortReviewCostScore,
        pr.stalenessSignalScore,
        pr.communityValueScore,
        pr.repoStrategicMultiplier,
        pr.finalScore,
        csvEscape(pr.recommendationBucket),
        csvEscape(pr.confidence),
        csvEscape(pr.tags.join("|")),
        csvEscape(pr.explanation.join(" | ")),
        csvEscape(pr.caveats.join(" | ")),
        pr.lowHangingFruit,
        csvEscape(pr.businessSignals.join("|")),
        csvEscape(pr.dependencySignals.join("|")),
      ].join(","),
    );
  });
  return `${rows.join("\n")}\n`;
}

function sanitizeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
