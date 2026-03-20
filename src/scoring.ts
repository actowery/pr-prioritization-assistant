import { ConfigBundle, PullRequestAnalysis } from "./types.js";
import { clamp, normalizeLabel, unique } from "./utils.js";

type RawPullRequestAnalysis = Omit<
  PullRequestAnalysis,
  | "businessRelevanceScore"
  | "unblockValueScore"
  | "mergeReadinessScore"
  | "effortReviewCostScore"
  | "stalenessSignalScore"
  | "communityValueScore"
  | "repoStrategicMultiplier"
  | "finalScore"
  | "tags"
  | "recommendationBucket"
  | "explanation"
  | "caveats"
  | "confidence"
>;

export function scorePullRequest(pr: RawPullRequestAnalysis, config: ConfigBundle): PullRequestAnalysis {
  const businessRelevanceScore = computeBusinessRelevance(pr, config);
  const unblockValueScore = computeUnblockValue(pr, config);
  const mergeReadinessScore = computeMergeReadiness(pr);
  const effortReviewCostScore = computeEffortReviewCost(pr);
  const stalenessSignalScore = computeStaleness(pr, config);
  const communityValueScore = computeCommunityValue(pr);
  const repoStrategicMultiplier = config.repoWeights[pr.repo] ?? 1;
  const lowHangingAssessment = assessLowHangingFruit(pr, config);
  const maintenancePenalty = computeMaintenancePenalty(pr, config);

  const weightedScore =
    businessRelevanceScore * config.weights.businessRelevance +
    unblockValueScore * config.weights.unblockValue +
    mergeReadinessScore * config.weights.mergeReadiness +
    effortReviewCostScore * config.weights.effortReviewCost +
    stalenessSignalScore * config.weights.stalenessSignal +
    communityValueScore * config.weights.communityValue -
    maintenancePenalty;

  const finalScore = Number((weightedScore * repoStrategicMultiplier).toFixed(2));
  const tags = deriveTags(pr, {
    businessRelevanceScore,
    unblockValueScore,
    mergeReadinessScore,
    effortReviewCostScore,
    stalenessSignalScore,
    communityValueScore,
    lowHangingFruit: lowHangingAssessment.lowHangingFruit,
  }, config);
  const recommendationBucket = deriveRecommendationBucket(
    finalScore,
    mergeReadinessScore,
    effortReviewCostScore,
    businessRelevanceScore,
    pr,
    lowHangingAssessment.lowHangingFruit,
    config,
  );
  const confidence = deriveConfidence(pr);

  return {
    ...pr,
    lowHangingFruit: lowHangingAssessment.lowHangingFruit,
    lowHangingReasons: lowHangingAssessment.reasons,
    businessRelevanceScore,
    unblockValueScore,
    mergeReadinessScore,
    effortReviewCostScore,
    stalenessSignalScore,
    communityValueScore,
    repoStrategicMultiplier,
    finalScore,
    tags,
    recommendationBucket,
    explanation: buildExplanation(
      pr,
      businessRelevanceScore,
      unblockValueScore,
      mergeReadinessScore,
      effortReviewCostScore,
      lowHangingAssessment.reasons,
      config,
    ),
    caveats: buildCaveats(pr, confidence),
    confidence,
  };
}

export function promotePickNextCandidates(
  pullRequests: PullRequestAnalysis[],
  config: ConfigBundle,
): PullRequestAnalysis[] {
  const currentPickNext = pullRequests.filter((pr) => pr.recommendationBucket === "Pick Next").length;
  const promotionsNeeded = Math.max(0, config.codeJamThresholds.pickNextTargetCount - currentPickNext);

  if (promotionsNeeded === 0) {
    return pullRequests;
  }

  const candidates = pullRequests.filter((pr) =>
    canPromoteToPickNext(pr, config),
  );

  for (const pr of candidates.slice(0, promotionsNeeded)) {
    pr.recommendationBucket = "Pick Next";
    pr.tags = unique([...pr.tags, "pick-next"]);
    if (!pr.explanation.some((line) => line.includes("strong next-up candidate"))) {
      pr.explanation = [
        "Promoted into Pick Next because it is a strong next-up candidate even with limited business metadata.",
        ...pr.explanation,
      ].slice(0, 5);
    }
  }

  return pullRequests;
}

function computeBusinessRelevance(pr: RawPullRequestAnalysis, config: ConfigBundle): number {
  let score = 1;
  score += Math.min(4, pr.businessSignals.length * 2);
  score += Math.min(2, pr.urgencySignals.length);
  score += computeAffiliationPriorityBoost(pr);
  score += hasConfiguredLabel(pr, config.labelRules.businessLabels) ? 2 : 0;
  score += (config.repoWeights[pr.repo] ?? 1) > 1 ? 1 : 0;
  score += hasCompatibilityOrPlatformSignal(pr) ? 2 : 0;
  score += pr.ownershipMatch === "requested-team" || pr.ownershipMatch === "requested-team+codeowners-path" ? 2
    : pr.ownershipMatch === "requested-team-member" || pr.ownershipMatch === "requested-team-member+codeowners-path" ? 1
    : pr.ownershipMatch === "codeowners-path" ? 1
    : 0;
  score -= isRoutineMaintenancePr(pr, config) ? 2 : 0;
  return clamp(score, 0, 10);
}

function computeUnblockValue(pr: RawPullRequestAnalysis, config: ConfigBundle): number {
  let score = 0;
  score += Math.min(5, pr.dependencySignals.length * 2);
  score += Math.min(2, pr.linkedIssues.length);
  score += hasConfiguredLabel(pr, config.labelRules.unblockLabels) ? 2 : 0;
  score += pr.directories.some((dir) => /(src|packages|core|sdk|api)/i.test(dir)) ? 1 : 0;
  score += hasCompatibilityOrPlatformSignal(pr) ? 1.5 : 0;
  return clamp(score, 0, 10);
}

function computeMergeReadiness(pr: RawPullRequestAnalysis): number {
  let score = 0;
  score += pr.readyForReview ? 2 : 0;
  score += pr.ciState === "passing" ? 3 : pr.ciState === "pending" ? 1 : 0;
  score += pr.mergeable === "mergeable" ? 2 : pr.mergeable === "conflicting" ? -2 : 0;
  score += pr.requiredReviewsComplete ? 2 : pr.approvals > 0 ? 1 : 0;
  score += pr.branchBehindBase ? -1 : 1;
  score += pr.maintainerBlocking ? -2 : 0;
  score += pr.reviewCommentCount <= 2 ? 1 : 0;
  return clamp(score, 0, 10);
}

function computeEffortReviewCost(pr: RawPullRequestAnalysis): number {
  let score = 10;
  if (pr.changedLines > 800) score -= 5;
  else if (pr.changedLines > 300) score -= 3;
  else if (pr.changedLines > 120) score -= 1.5;

  if (pr.changedFiles > 20) score -= 3;
  else if (pr.changedFiles > 8) score -= 1.5;

  if (pr.riskReasons.length > 0) score -= Math.min(3, pr.riskReasons.length);
  if (pr.reviewCommentCount + pr.issueCommentCount > 12) score -= 2;
  if (pr.directories.length > 5) score -= 1;
  return clamp(score, 0, 10);
}

function computeStaleness(pr: RawPullRequestAnalysis, config: ConfigBundle): number {
  let score = 5;
  if (pr.ageDays > 21 && pr.daysSinceLastUpdate <= 7) score += 2;
  if (pr.ageDays > 45 && pr.daysSinceLastUpdate > 21) score -= 4;
  if (pr.ageDays > 120 && pr.daysSinceLastUpdate > 60) score -= 3;
  if (pr.daysSinceLastUpdate <= 3) score += 2;
  if (pr.daysSinceLastUpdate > 30) score -= 2;
  if (pr.daysSinceLastAuthorInteraction !== undefined && pr.daysSinceLastAuthorInteraction > 30) score -= 2;
  if (pr.daysSinceLastMaintainerInteraction !== undefined && pr.daysSinceLastMaintainerInteraction > 30) score += 1;
  if (isRoutineMaintenancePr(pr, config) && pr.ageDays > 30) score -= 2;
  return clamp(score, 0, 10);
}

function computeCommunityValue(pr: RawPullRequestAnalysis): number {
  let score = 0;
  if (isBotPr(pr)) {
    return 0;
  }
  if (hasAffiliationCategory(pr, "vip_orgs")) {
    score += 2.5;
  } else if (hasAffiliationCategory(pr, "top_module_contributors")) {
    score += 1.75;
  } else if (hasAffiliationCategory(pr, "top_community_contributors")) {
    score += 1.25;
  } else if (pr.affiliation) {
    score += 0.5;
  }
  if (pr.authorAssociation && ["NONE", "FIRST_TIMER", "FIRST_TIME_CONTRIBUTOR", "CONTRIBUTOR"].includes(pr.authorAssociation)) {
    score += 2;
  }
  if (pr.labels.some((label) => /(docs|community|good first issue|public)/i.test(label))) {
    score += 1.5;
  }
  if (!pr.affiliation && pr.authorAssociation === "NONE") {
    score += 1;
  }
  return clamp(score, 0, 5);
}

function assessLowHangingFruit(pr: RawPullRequestAnalysis, config: ConfigBundle): {
  lowHangingFruit: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const thresholds = config.lowHangingThresholds;

  if (pr.changedLines <= thresholds.maxChangedLines) reasons.push("small diff");
  if (pr.changedFiles <= thresholds.maxFilesChanged) reasons.push("few files changed");
  if (pr.ciState === "passing") reasons.push("CI passing");
  if (pr.mergeable === "mergeable") reasons.push("no merge conflicts detected");
  if (pr.reviewCommentCount <= thresholds.maxReviewComments) reasons.push("limited review discussion");
  if (pr.ageDays >= thresholds.minAgeDays && pr.ageDays <= 45) reasons.push("moderately aged");
  if (hasConfiguredLabel(pr, config.labelRules.quickWinLabels) || pr.labels.some((label) => /(docs|typo|test|compat|small fix)/i.test(label))) {
    reasons.push("label hints at narrow scope");
  }
  if (hasCompatibilityOrPlatformSignal(pr)) {
    reasons.push("compatibility/platform update");
  }

  return {
    lowHangingFruit:
      reasons.length >= 4 &&
      pr.riskReasons.length < 2 &&
      !pr.isDraft &&
      !isRoutineMaintenancePr(pr, config) &&
      pr.daysSinceLastUpdate <= 45,
    reasons: unique(reasons),
  };
}

function deriveTags(
  pr: RawPullRequestAnalysis,
  scores: {
    businessRelevanceScore: number;
    unblockValueScore: number;
    mergeReadinessScore: number;
    effortReviewCostScore: number;
    stalenessSignalScore: number;
    communityValueScore: number;
    lowHangingFruit: boolean;
  },
  config: ConfigBundle,
): string[] {
  const tags: string[] = [];
  if (scores.businessRelevanceScore >= 7 && scores.mergeReadinessScore >= 7 && scores.effortReviewCostScore >= 6) {
    tags.push("pick-next");
  }
  if (scores.lowHangingFruit) tags.push("low-hanging-fruit");
  if (scores.businessRelevanceScore >= 7) tags.push("high-business-value");
  if (scores.unblockValueScore >= 7) tags.push("high-unblock-value");
  if (scores.mergeReadinessScore >= 8) tags.push("merge-ready");
  if (scores.effortReviewCostScore <= 4) tags.push("high-review-cost");
  if (scores.stalenessSignalScore >= 7 && pr.ageDays > 21) tags.push("stale-but-salvageable");
  if (scores.effortReviewCostScore <= 4 && scores.businessRelevanceScore >= 7) tags.push("not-code-jam-friendly");
  if (
    pr.businessSignals.some((signal) => signal.includes("customer")) ||
    pr.labels.some((label) => normalizeLabel(label).includes("customer")) ||
    hasConfiguredLabel(pr, config.labelRules.customerLabels)
  ) {
    tags.push("customer-adjacent");
  }
  if (scores.communityValueScore >= 3) tags.push("public-goodwill");
  if (isRoutineMaintenancePr(pr, config)) tags.push("not-code-jam-friendly");
  if (
    pr.businessSignals.length === 0 &&
    pr.dependencySignals.length === 0 &&
    pr.labels.length === 0 &&
    !hasCompatibilityOrPlatformSignal(pr)
  ) {
    tags.push("needs-human-judgment");
  }
  return unique(tags);
}

function deriveRecommendationBucket(
  finalScore: number,
  mergeReadinessScore: number,
  effortReviewCostScore: number,
  businessRelevanceScore: number,
  pr: RawPullRequestAnalysis,
  lowHangingFruit: boolean,
  config: ConfigBundle,
): PullRequestAnalysis["recommendationBucket"] {
  if (
    finalScore >= config.codeJamThresholds.pickNextMinScore &&
    mergeReadinessScore >= 7 &&
    effortReviewCostScore >= 6 &&
    !isRoutineMaintenancePr(pr, config)
  ) {
    return "Pick Next";
  }
  if (
    hasCompatibilityOrPlatformSignal(pr) &&
    mergeReadinessScore >= 8 &&
    effortReviewCostScore >= 7 &&
    !isRoutineMaintenancePr(pr, config)
  ) {
    return "Quick Wins";
  }
  if (lowHangingFruit && finalScore >= config.codeJamThresholds.quickWinMinScore) {
    return "Quick Wins";
  }
  if (
    businessRelevanceScore >= config.codeJamThresholds.importantButHeavyBusinessScore &&
    effortReviewCostScore <= config.codeJamThresholds.importantButHeavyEffortMax
  ) {
    return "Important but Heavy";
  }
  if (isRoutineMaintenancePr(pr, config)) {
    return "Probably Deprioritize for Code Jam";
  }
  if (
    pr.businessSignals.length === 0 &&
    pr.dependencySignals.length === 0 &&
    pr.labels.length === 0 &&
    !hasCompatibilityOrPlatformSignal(pr)
  ) {
    return "Needs Clarification";
  }
  return "Probably Deprioritize for Code Jam";
}

function canPromoteToPickNext(pr: PullRequestAnalysis, config: ConfigBundle): boolean {
  if (pr.recommendationBucket === "Pick Next") {
    return false;
  }

  if (isRoutineMaintenancePr(pr, config)) {
    return false;
  }

  if (pr.finalScore < config.codeJamThresholds.pickNextFloorScore) {
    return false;
  }

  if (pr.mergeReadinessScore < config.codeJamThresholds.pickNextFallbackMergeReadinessMin) {
    return false;
  }

  if (pr.effortReviewCostScore < config.codeJamThresholds.pickNextFallbackEffortMin) {
    return false;
  }

  if (
    pr.recommendationBucket === "Quick Wins" ||
    pr.businessRelevanceScore >= 5 ||
    pr.unblockValueScore >= 5 ||
    hasCompatibilityOrPlatformSignal(pr)
  ) {
    return true;
  }

  return false;
}

function buildExplanation(
  pr: RawPullRequestAnalysis,
  businessRelevanceScore: number,
  unblockValueScore: number,
  mergeReadinessScore: number,
  effortReviewCostScore: number,
  lowHangingReasons: string[],
  config: ConfigBundle,
): string[] {
  const lines: string[] = [];
  if (businessRelevanceScore >= 7) {
    lines.push("High business relevance from labels, repo weighting, or stakeholder-language signals.");
  }
  if (hasAffiliationCategory(pr, "vip_orgs")) {
    lines.push("Author maps to a VIP org affiliation, which is weighted strongly in prioritization.");
  } else if (hasAffiliationCategory(pr, "top_module_contributors")) {
    lines.push("Author is mapped as a top module contributor across the configured repo set.");
  } else if (hasAffiliationCategory(pr, "top_community_contributors")) {
    lines.push("Author is mapped as a top community contributor.");
  }
  if (pr.ownershipMatch === "requested-team" || pr.ownershipMatch === "requested-team+codeowners-path") {
    lines.push("The requested CODEOWNERS team is directly assigned to review this PR.");
  } else if (
    pr.ownershipMatch === "requested-team-member" ||
    pr.ownershipMatch === "requested-team-member+codeowners-path"
  ) {
    lines.push("A member of the requested CODEOWNERS team is assigned to review this PR.");
  }
  if (
    pr.ownershipMatch === "codeowners-path" ||
    pr.ownershipMatch === "requested-team+codeowners-path" ||
    pr.ownershipMatch === "requested-team-member+codeowners-path"
  ) {
    lines.push("Changed files match CODEOWNERS paths owned by the requested team.");
  }
  if (hasCompatibilityOrPlatformSignal(pr)) {
    lines.push("Includes compatibility or platform-support work that may be useful to land opportunistically.");
  }
  if (unblockValueScore >= 6) {
    lines.push("Contains likely unblock or dependency language that suggests downstream value.");
  }
  if (mergeReadinessScore >= 7) {
    lines.push("Looks close to merge-ready based on CI, conflicts, draft state, and review posture.");
  }
  if (effortReviewCostScore >= 7) {
    lines.push("Appears inexpensive to review relative to the rest of the queue.");
  }
  if (lowHangingReasons.length > 0) {
    lines.push(`Low-hanging-fruit signals: ${lowHangingReasons.slice(0, 3).join(", ")}.`);
  }
  if (isRoutineMaintenancePr(pr, config)) {
    lines.push("Looks like routine maintenance or automation churn, so it is deprioritized for a human code jam.");
  }
  if (lines.length < 2) {
    lines.push("Ranking is based on incomplete signals and should be treated as a lightweight recommendation.");
    lines.push("Human review is still needed to confirm business timing, ownership, and release context.");
  }
  return lines.slice(0, 5);
}

function buildCaveats(pr: RawPullRequestAnalysis, confidence: PullRequestAnalysis["confidence"]): string[] {
  const caveats: string[] = [];
  if (confidence === "low") {
    caveats.push("Low confidence: business context was sparse, so the score leans heavily on metadata.");
  }
  if (pr.ciState === "unknown") {
    caveats.push("CI status could not be determined confidently.");
  }
  if (pr.mergeable === "unknown") {
    caveats.push("Mergeability signal was incomplete.");
  }
  if (!pr.affiliation) {
    caveats.push("No affiliation mapping was supplied for the author.");
  }
  return caveats;
}

function deriveConfidence(pr: RawPullRequestAnalysis): PullRequestAnalysis["confidence"] {
  const signalCount =
    pr.businessSignals.length +
    pr.dependencySignals.length +
    pr.labels.length +
    (pr.affiliation ? 1 : 0);
  if (signalCount >= 5) return "high";
  if (signalCount >= 2) return "medium";
  return "low";
}

function computeMaintenancePenalty(pr: RawPullRequestAnalysis, config: ConfigBundle): number {
  let penalty = 0;
  if (isRoutineMaintenancePr(pr, config)) {
    penalty += 1.5;
  }
  if (isBotPr(pr)) {
    penalty += 0.75;
  }
  return penalty;
}

function isBotPr(pr: RawPullRequestAnalysis): boolean {
  return /\[bot\]$/i.test(pr.author) || /\bbot\b/i.test(pr.author);
}

function isRoutineMaintenancePr(pr: RawPullRequestAnalysis, config: ConfigBundle): boolean {
  const text = `${pr.title}\n${pr.body}\n${pr.labels.join(" ")}`.toLowerCase();
  return (
    /configure mend|mend for github|dependabot|renovate|pdk update|workflow|codeowners|devcontainer|github actions|ci\b/.test(text) ||
    hasConfiguredLabel(pr, config.labelRules.maintenanceLabels) ||
    isBotPr(pr)
  );
}

function computeAffiliationPriorityBoost(pr: RawPullRequestAnalysis): number {
  if (!pr.affiliation) {
    return 0;
  }

  if (hasAffiliationCategory(pr, "vip_orgs")) {
    return 3;
  }

  if (hasAffiliationCategory(pr, "top_module_contributors")) {
    return 2;
  }

  if (hasAffiliationCategory(pr, "top_community_contributors")) {
    return 1.5;
  }

  if (hasAffiliationCategory(pr, "customer_success")) {
    return 1.25;
  }

  if (hasAffiliationCategory(pr, "internal_staff")) {
    return 1;
  }

  return 0.5;
}

function hasAffiliationCategory(pr: RawPullRequestAnalysis, category: string): boolean {
  if (!pr.affiliation) {
    return false;
  }

  return pr.affiliation
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .includes(category.toLowerCase());
}

function hasCompatibilityOrPlatformSignal(pr: RawPullRequestAnalysis): boolean {
  const text = `${pr.title}\n${pr.body}\n${pr.labels.join(" ")}`.toLowerCase();
  return /support|compat|compatibility|debian|ubuntu|centos|oraclelinux|rocky|almalinux|puppet ?8|puppetcore|major version|trixie/.test(
    text,
  );
}

function hasConfiguredLabel(pr: RawPullRequestAnalysis, configuredLabels: string[]): boolean {
  const normalizedConfigured = configuredLabels.map((label) => label.toLowerCase());
  return pr.labels.some((label) =>
    normalizedConfigured.some((configured) => label.toLowerCase().includes(configured)),
  );
}
