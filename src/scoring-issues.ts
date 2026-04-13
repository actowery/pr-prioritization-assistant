import { DEFAULT_ISSUE_THRESHOLDS, DEFAULT_ISSUE_WEIGHTS } from "./constants.js";
import { RawIssueAnalysis } from "./github/client.js";
import { ConfigBundle, IssueAnalysis, IssueThresholds } from "./types.js";
import { clamp, normalizeLabel, unique } from "./utils.js";

export function scoreIssue(issue: RawIssueAnalysis, config: ConfigBundle): IssueAnalysis {
  const weights = config.issueWeights ?? DEFAULT_ISSUE_WEIGHTS;
  const thresholds = config.issueThresholds ?? DEFAULT_ISSUE_THRESHOLDS;

  const businessRelevanceScore = computeIssueBusinessRelevance(issue, config);
  const unblockValueScore = computeIssueUnblockValue(issue, config);
  const triageReadinessScore = computeTriageReadiness(issue);
  const effortToResolveScore = computeIssueEffortToResolve(issue);
  const stalenessSignalScore = computeIssueStaleness(issue, thresholds);
  const communityValueScore = computeIssueCommunityValue(issue);
  const repoStrategicMultiplier = config.repoWeights[issue.repo] ?? 1;

  const botPenalty = isBotIssue(issue) ? 0.75 : 0;

  const weightedScore =
    businessRelevanceScore * weights.businessRelevance +
    unblockValueScore * weights.unblockValue +
    triageReadinessScore * weights.triageReadiness +
    effortToResolveScore * weights.effortToResolve +
    stalenessSignalScore * weights.stalenessSignal +
    communityValueScore * weights.communityValue -
    botPenalty;

  const finalScore = Number((weightedScore * repoStrategicMultiplier).toFixed(2));

  const tags = deriveIssueTags(issue, {
    businessRelevanceScore,
    unblockValueScore,
    triageReadinessScore,
    effortToResolveScore,
    stalenessSignalScore,
    communityValueScore,
  }, config);

  const recommendationBucket = deriveIssueBucket(
    finalScore,
    triageReadinessScore,
    effortToResolveScore,
    businessRelevanceScore,
    issue,
    thresholds,
  );

  const confidence = deriveIssueConfidence(issue);

  return {
    ...issue,
    businessRelevanceScore,
    unblockValueScore,
    triageReadinessScore,
    effortToResolveScore,
    stalenessSignalScore,
    communityValueScore,
    repoStrategicMultiplier,
    finalScore,
    tags,
    recommendationBucket,
    explanation: buildIssueExplanation(issue, businessRelevanceScore, unblockValueScore, triageReadinessScore, effortToResolveScore),
    caveats: buildIssueCaveats(issue, confidence),
    confidence,
  };
}

export function promoteActNowCandidates(
  issues: IssueAnalysis[],
  config: ConfigBundle,
): IssueAnalysis[] {
  const thresholds = config.issueThresholds ?? DEFAULT_ISSUE_THRESHOLDS;
  const currentActNow = issues.filter((i) => i.recommendationBucket === "Act Now").length;
  const promotionsNeeded = Math.max(0, thresholds.actNowTargetCount - currentActNow);

  if (promotionsNeeded === 0) {
    return issues;
  }

  const candidates = issues.filter((i) =>
    i.recommendationBucket !== "Act Now" &&
    i.finalScore >= thresholds.actNowFloorScore &&
    i.triageReadinessScore >= 5 &&
    i.businessRelevanceScore >= 5,
  );

  for (const issue of candidates.slice(0, promotionsNeeded)) {
    issue.recommendationBucket = "Act Now";
    issue.tags = unique([...issue.tags, "act-now"]);
    if (!issue.explanation.some((line) => line.includes("strong next-up candidate"))) {
      issue.explanation = [
        "Promoted into Act Now as a strong next-up candidate based on business and triage signals.",
        ...issue.explanation,
      ].slice(0, 5);
    }
  }

  return issues;
}

function computeIssueBusinessRelevance(issue: RawIssueAnalysis, config: ConfigBundle): number {
  let score = 1;
  score += Math.min(4, issue.businessSignals.length * 2);
  score += Math.min(2, issue.urgencySignals.length);
  score += computeIssueAffiliationBoost(issue);
  score += hasConfiguredLabel(issue.labels, config.labelRules.businessLabels) ? 2 : 0;
  score += (config.repoWeights[issue.repo] ?? 1) > 1 ? 1 : 0;
  score += issue.milestone !== undefined ? 1.5 : 0;
  score += issue.ageDays <= 14 ? 1 : 0;
  return clamp(score, 0, 10);
}

function computeIssueUnblockValue(issue: RawIssueAnalysis, config: ConfigBundle): number {
  let score = 0;
  score += Math.min(5, issue.dependencySignals.length * 2);
  score += Math.min(3, issue.linkedPrNumbers.length * 1.5);
  score += hasConfiguredLabel(issue.labels, config.labelRules.unblockLabels) ? 2 : 0;
  score += issue.milestone !== undefined ? 1 : 0;
  return clamp(score, 0, 10);
}

function computeTriageReadiness(issue: RawIssueAnalysis): number {
  let score = 0;
  score += issue.assignees.length > 0 ? 3 : 0;
  score += issue.labels.length > 0 ? 2 : 0;
  score += issue.linkedPrNumbers.length > 0 ? 2 : 0;
  score += hasReproductionStepsSignal(issue.body) ? 2 : 0;
  score -= issue.commentCount > 20 ? 1 : 0;
  return clamp(score, 0, 10);
}

function computeIssueEffortToResolve(issue: RawIssueAnalysis): number {
  let score = 10;
  if (issue.commentCount > 30) score -= 4;
  else if (issue.commentCount > 15) score -= 2;
  else if (issue.commentCount > 8) score -= 1;

  if (issue.body.length > 3000) score -= 2;
  else if (issue.body.length > 1500) score -= 1;

  if (issue.linkedPrNumbers.length > 3) score -= 2;
  else if (issue.linkedPrNumbers.length > 1) score -= 1;

  if (/refactor|redesign|overhaul|migrate|rewrite|architectural/i.test(`${issue.title}\n${issue.body}`)) {
    score -= 2;
  }

  return clamp(score, 0, 10);
}

function computeIssueStaleness(
  issue: RawIssueAnalysis,
  thresholds: IssueThresholds,
): number {
  let score = 5;
  if (issue.ageDays > 21 && issue.daysSinceLastUpdate <= 7) score += 2;
  if (issue.ageDays > thresholds.staleIssueAgeDays && issue.daysSinceLastUpdate > thresholds.staleIssueIdleDays) score -= 4;
  if (issue.ageDays > 120 && issue.daysSinceLastUpdate > 60) score -= 3;
  if (issue.daysSinceLastUpdate <= 3) score += 2;
  if (issue.daysSinceLastUpdate > 30) score -= 2;
  return clamp(score, 0, 10);
}

function computeIssueCommunityValue(issue: RawIssueAnalysis): number {
  let score = 0;
  if (isBotIssue(issue)) return 0;
  score += Math.min(3, issue.reactionCount * 0.3);
  score += Math.min(2, computeIssueAffiliationBoost(issue));
  if (issue.authorAssociation && ["NONE", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "CONTRIBUTOR"].includes(issue.authorAssociation)) {
    score += 1.5;
  }
  if (issue.labels.some((label) => /(good first issue|help wanted|community)/i.test(label))) {
    score += 1;
  }
  return clamp(score, 0, 5);
}

function deriveIssueBucket(
  finalScore: number,
  triageReadinessScore: number,
  effortToResolveScore: number,
  businessRelevanceScore: number,
  issue: RawIssueAnalysis,
  thresholds: IssueThresholds,
): IssueAnalysis["recommendationBucket"] {
  if (
    finalScore >= thresholds.actNowMinScore &&
    triageReadinessScore >= 6 &&
    issue.assignees.length > 0
  ) {
    return "Act Now";
  }
  if (
    effortToResolveScore >= 7 &&
    (issue.labels.length > 0 || issue.assignees.length > 0) &&
    finalScore >= thresholds.quickTriageMinScore
  ) {
    return "Quick Triage";
  }
  if (
    businessRelevanceScore >= thresholds.importantNeedsScopingBusinessScore &&
    effortToResolveScore <= thresholds.importantNeedsScopingEffortMax
  ) {
    return "Important but Needs Scoping";
  }
  if (
    issue.labels.length === 0 &&
    issue.assignees.length === 0 &&
    !hasReproductionStepsSignal(issue.body) &&
    issue.commentCount < 3
  ) {
    return "Needs More Info";
  }
  return "Deprioritize";
}

function deriveIssueTags(
  issue: RawIssueAnalysis,
  scores: {
    businessRelevanceScore: number;
    unblockValueScore: number;
    triageReadinessScore: number;
    effortToResolveScore: number;
    stalenessSignalScore: number;
    communityValueScore: number;
  },
  config: ConfigBundle,
): string[] {
  const tags: string[] = [];
  if (scores.triageReadinessScore >= 7) tags.push("triage-ready");
  if (scores.businessRelevanceScore >= 7) tags.push("high-business-value");
  if (scores.unblockValueScore >= 7) tags.push("high-unblock-value");
  if (issue.reactionCount >= 5 || scores.communityValueScore >= 3) tags.push("community-signal");
  if (issue.linkedPrNumbers.length > 0) tags.push("has-linked-prs");
  if (issue.milestone !== undefined) tags.push("milestone-gated");
  if (issue.ageDays > 21 && issue.daysSinceLastUpdate <= 7) tags.push("stale-but-active");
  if (
    issue.businessSignals.length === 0 &&
    issue.dependencySignals.length === 0 &&
    issue.labels.length === 0
  ) {
    tags.push("needs-human-judgment");
  }
  if (
    issue.businessSignals.some((signal) => signal.includes("customer")) ||
    issue.labels.some((label) => normalizeLabel(label).includes("customer")) ||
    hasConfiguredLabel(issue.labels, config.labelRules.customerLabels)
  ) {
    tags.push("customer-adjacent");
  }
  return unique(tags);
}

function deriveIssueConfidence(issue: RawIssueAnalysis): IssueAnalysis["confidence"] {
  const signalCount =
    issue.businessSignals.length +
    issue.dependencySignals.length +
    issue.labels.length +
    (issue.affiliation ? 1 : 0) +
    (issue.assignees.length > 0 ? 1 : 0);
  if (signalCount >= 5) return "high";
  if (signalCount >= 2) return "medium";
  return "low";
}

function buildIssueExplanation(
  issue: RawIssueAnalysis,
  businessRelevanceScore: number,
  unblockValueScore: number,
  triageReadinessScore: number,
  effortToResolveScore: number,
): string[] {
  const lines: string[] = [];
  if (businessRelevanceScore >= 7) {
    lines.push("High business relevance from labels, repo weighting, or urgency signals.");
  }
  if (issue.milestone !== undefined) {
    lines.push(`Issue is associated with milestone "${issue.milestone}", which adds scheduling weight.`);
  }
  if (unblockValueScore >= 6) {
    lines.push("Contains blocking or dependency language that suggests downstream value.");
  }
  if (triageReadinessScore >= 7) {
    lines.push("Issue looks triage-ready: assigned, labeled, and has reproduction context or linked PRs.");
  }
  if (effortToResolveScore >= 7) {
    lines.push("Appears relatively simple to resolve based on discussion volume and description length.");
  }
  if (issue.reactionCount >= 5) {
    lines.push(`Community engagement signal: ${issue.reactionCount} reactions suggest broad interest.`);
  }
  if (computeIssueAffiliationBoost(issue) >= 2) {
    lines.push("Author affiliation maps to a high-priority contributor category.");
  }
  if (lines.length < 2) {
    lines.push("Ranking is based on incomplete signals; treat as a lightweight recommendation.");
    lines.push("Human triage is needed to confirm business timing and resolution ownership.");
  }
  return lines.slice(0, 5);
}

function buildIssueCaveats(issue: RawIssueAnalysis, confidence: IssueAnalysis["confidence"]): string[] {
  const caveats: string[] = [];
  if (confidence === "low") {
    caveats.push("Low confidence: business context was sparse, so the score leans on limited metadata.");
  }
  if (!issue.affiliation) {
    caveats.push("No affiliation mapping was supplied for the author.");
  }
  if (issue.labels.length === 0) {
    caveats.push("Issue has no labels, which limits signal quality.");
  }
  return caveats;
}

function isBotIssue(issue: RawIssueAnalysis): boolean {
  return /\[bot\]$/i.test(issue.author) || /\bbot\b/i.test(issue.author);
}

function computeIssueAffiliationBoost(issue: RawIssueAnalysis): number {
  if (!issue.affiliation) return 0;
  if (hasAffiliationCategory(issue.affiliation, "vip_orgs")) return 3;
  if (hasAffiliationCategory(issue.affiliation, "top_module_contributors")) return 2;
  if (hasAffiliationCategory(issue.affiliation, "top_community_contributors")) return 1.5;
  if (hasAffiliationCategory(issue.affiliation, "customer_success")) return 1.25;
  if (hasAffiliationCategory(issue.affiliation, "internal_staff")) return 1;
  return 0.5;
}

function hasAffiliationCategory(affiliation: string, category: string): boolean {
  return affiliation
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .includes(category.toLowerCase());
}

function hasReproductionStepsSignal(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    /steps to reproduce|reproduction steps|how to reproduce|repro:/.test(lower) ||
    /```[\s\S]{20,}```/.test(body) ||
    lower.includes("minimal example") ||
    lower.includes("sample code")
  );
}

function hasConfiguredLabel(labels: string[], configuredLabels: string[]): boolean {
  const normalizedConfigured = configuredLabels.map((l) => l.toLowerCase());
  return labels.some((label) =>
    normalizedConfigured.some((configured) => label.toLowerCase().includes(configured)),
  );
}

