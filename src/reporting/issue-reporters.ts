import { join } from "node:path";
import { IssueAnalysis, IssueFullReport, OutputFormat } from "../types.js";
import { csvEscape, ensureDir, writeTextFile } from "../utils.js";

export async function writeIssueReports(
  report: IssueFullReport,
  outputDir: string,
  format: OutputFormat,
): Promise<string[]> {
  await ensureDir(outputDir);
  const writtenFiles: string[] = [];

  if (format === "all" || format === "json") {
    const path = join(outputDir, "issue-priorities.json");
    await writeTextFile(path, `${JSON.stringify(report, null, 2)}\n`);
    writtenFiles.push(path);
  }

  if (format === "all" || format === "md") {
    const path = join(outputDir, "issue-priorities.md");
    await writeTextFile(path, renderIssueMarkdown(report));
    writtenFiles.push(path);
  }

  if (format === "all" || format === "csv") {
    const path = join(outputDir, "issue-priorities.csv");
    await writeTextFile(path, renderIssueCsv(report.issues));
    writtenFiles.push(path);
  }

  return writtenFiles;
}

export function renderIssueMarkdown(report: IssueFullReport): string {
  const lines: string[] = [];
  lines.push("# Issue Prioritization Report");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Authentication mode: ${report.summary.authModeLabel}`);
  lines.push(`- Repos scanned: ${report.summary.scannedRepos}`);
  lines.push(`- Reachable repos: ${report.summary.reachableRepos}`);
  lines.push(`- Open issues analyzed: ${report.summary.totalIssues}`);
  lines.push(`- Act Now: ${report.summary.actNowCount}`);
  lines.push(`- Quick Triage: ${report.summary.quickTriageCount}`);
  lines.push(`- Important but Needs Scoping: ${report.summary.importantNeedsScopingCount}`);
  lines.push(`- Needs More Info: ${report.summary.needsMoreInfoCount}`);
  lines.push(`- Deprioritize: ${report.summary.deprioritizeCount}`);
  if (report.issues.length === 0 && report.summary.partialFailures.length > 0) {
    lines.push(`- Run quality: incomplete due to partial failures or rate limiting`);
  } else if (report.issues.length === 0) {
    lines.push(`- Run quality: no issues matched the current filters`);
  }

  if (report.summary.partialFailures.length > 0) {
    lines.push("");
    lines.push("## Partial Failures");
    lines.push("");
    for (const failure of report.summary.partialFailures) {
      lines.push(`- **${failure.repo}**: ${failure.error}`);
    }
  }

  if (report.issues.length > 0) {
    lines.push("");
    lines.push("## Top Recommendations");
    lines.push("");
    const top = report.issues.slice(0, 10);
    for (const [index, issue] of top.entries()) {
      lines.push(`### ${index + 1}. [${issue.repo} #${issue.number}](${issue.url}) — ${issue.title}`);
      lines.push("");
      lines.push(`- **Score**: ${issue.finalScore} | **Bucket**: ${issue.recommendationBucket} | **Confidence**: ${issue.confidence}`);
      lines.push(`- **Tags**: ${issue.tags.length > 0 ? issue.tags.join(", ") : "none"}`);
      if (issue.explanation.length > 0) {
        lines.push(`- ${issue.explanation[0]}`);
      }
      lines.push("");
    }
  }

  const buckets: Array<{ key: keyof typeof report.recommendationGroups; label: string }> = [
    { key: "actNow", label: "Act Now" },
    { key: "quickTriage", label: "Quick Triage" },
    { key: "importantNeedsScoping", label: "Important but Needs Scoping" },
    { key: "needsMoreInfo", label: "Needs More Info" },
    { key: "deprioritize", label: "Deprioritize" },
  ];

  lines.push("## Recommendation Buckets");
  lines.push("");

  for (const bucket of buckets) {
    const items = report.recommendationGroups[bucket.key];
    lines.push(`### ${bucket.label} (${items.length})`);
    lines.push("");
    if (items.length === 0) {
      lines.push("_None_");
    } else {
      for (const issue of items) {
        lines.push(`#### [${issue.repo} #${issue.number}](${issue.url}) — ${issue.title}`);
        lines.push("");
        lines.push(`- Score: ${issue.finalScore} | Triage readiness: ${issue.triageReadinessScore.toFixed(1)} | Effort: ${issue.effortToResolveScore.toFixed(1)}`);
        lines.push(`- Author: ${issue.author}${issue.affiliation ? ` (${issue.affiliation})` : ""}`);
        if (issue.assignees.length > 0) lines.push(`- Assignees: ${issue.assignees.join(", ")}`);
        if (issue.labels.length > 0) lines.push(`- Labels: ${issue.labels.join(", ")}`);
        if (issue.milestone !== undefined) lines.push(`- Milestone: ${issue.milestone}`);
        if (issue.linkedPrNumbers.length > 0) lines.push(`- Linked PRs: ${issue.linkedPrNumbers.map((n) => `#${n}`).join(", ")}`);
        if (issue.reactionCount > 0) lines.push(`- Reactions: ${issue.reactionCount}`);
        if (issue.explanation.length > 0) {
          lines.push(`- Explanation:`);
          for (const line of issue.explanation) {
            lines.push(`  - ${line}`);
          }
        }
        if (issue.caveats.length > 0) {
          lines.push(`- Caveats:`);
          for (const caveat of issue.caveats) {
            lines.push(`  - ${caveat}`);
          }
        }
        lines.push(`- Tags: ${issue.tags.length > 0 ? issue.tags.join(", ") : "none"}`);
        lines.push("");
      }
    }
    lines.push("");
  }

  if (report.repoSummaries.length > 0) {
    lines.push("## Repo Summaries");
    lines.push("");
    for (const summary of report.repoSummaries) {
      lines.push(`### ${summary.repo}`);
      lines.push("");
      lines.push(`- Total open issues: ${summary.totalOpenIssues}`);
      lines.push(`- High-score issues: ${summary.highScoreIssues}`);
      lines.push(`- Stale issues: ${summary.staleIssues}`);
      lines.push(`- Act Now: ${summary.actNowIssues}`);
      lines.push(`- Quick Triage: ${summary.quickTriageIssues}`);
      if (summary.recommendedTopIssue) {
        const top = summary.recommendedTopIssue;
        lines.push(`- Top issue: [#${top.number}](${top.url}) ${top.title} (score: ${top.score})`);
      }
      lines.push("");
    }
  }

  lines.push("## Caveats");
  lines.push("");
  for (const caveat of report.caveats) {
    lines.push(`- ${caveat}`);
  }
  lines.push("");

  if (report.issues.length > 0) {
    lines.push("## Full Ranked Table");
    lines.push("");
    lines.push("| Rank | Repo | Issue | Title | Score | Bucket | Triage | Effort | Reactions | Tags |");
    lines.push("|---|---|---|---|---|---|---|---|---|---|");
    for (const [index, issue] of report.issues.entries()) {
      const title = issue.title.length > 60 ? `${issue.title.slice(0, 57)}...` : issue.title;
      lines.push(
        `| ${index + 1} | ${issue.repo} | [#${issue.number}](${issue.url}) | ${title} | ${issue.finalScore} | ${issue.recommendationBucket} | ${issue.triageReadinessScore.toFixed(1)} | ${issue.effortToResolveScore.toFixed(1)} | ${issue.reactionCount} | ${issue.tags.join(", ")} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderIssueCsv(issues: IssueAnalysis[]): string {
  const header = [
    "rank",
    "repo",
    "issue_number",
    "title",
    "url",
    "author",
    "author_association",
    "affiliation",
    "age_days",
    "days_since_last_update",
    "comment_count",
    "reaction_count",
    "assignees",
    "labels",
    "milestone",
    "linked_pr_count",
    "triage_readiness_score",
    "business_relevance_score",
    "unblock_value_score",
    "effort_to_resolve_score",
    "staleness_signal_score",
    "community_value_score",
    "repo_multiplier",
    "final_score",
    "recommendation_bucket",
    "confidence",
    "tags",
    "explanation",
    "caveats",
    "business_signals",
    "dependency_signals",
    "urgency_signals",
  ].join(",");

  const rows = issues.map((issue, index) =>
    [
      index + 1,
      csvEscape(issue.repo),
      issue.number,
      csvEscape(issue.title),
      csvEscape(issue.url),
      csvEscape(issue.author),
      csvEscape(issue.authorAssociation ?? ""),
      csvEscape(issue.affiliation ?? ""),
      issue.ageDays,
      issue.daysSinceLastUpdate,
      issue.commentCount,
      issue.reactionCount,
      csvEscape(issue.assignees.join("|")),
      csvEscape(issue.labels.join("|")),
      csvEscape(issue.milestone ?? ""),
      issue.linkedPrNumbers.length,
      issue.triageReadinessScore.toFixed(2),
      issue.businessRelevanceScore.toFixed(2),
      issue.unblockValueScore.toFixed(2),
      issue.effortToResolveScore.toFixed(2),
      issue.stalenessSignalScore.toFixed(2),
      issue.communityValueScore.toFixed(2),
      issue.repoStrategicMultiplier.toFixed(2),
      issue.finalScore,
      csvEscape(issue.recommendationBucket),
      issue.confidence,
      csvEscape(issue.tags.join("|")),
      csvEscape(issue.explanation.join(" | ")),
      csvEscape(issue.caveats.join(" | ")),
      csvEscape(issue.businessSignals.join("|")),
      csvEscape(issue.dependencySignals.join("|")),
      csvEscape(issue.urgencySignals.join("|")),
    ].join(","),
  );

  return [header, ...rows].join("\n");
}
