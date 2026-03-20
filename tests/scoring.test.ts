import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../src/constants.js";
import { promotePickNextCandidates, scorePullRequest } from "../src/scoring.js";
import { PullRequestAnalysis } from "../src/types.js";

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

function makeBasePr(overrides: Partial<RawPullRequestAnalysis> = {}): RawPullRequestAnalysis {
  return {
    repo: "owner-example/priority-sdk",
    repoOwner: "owner-example",
    repoName: "priority-sdk",
    repoUrl: "https://example.invalid/owner-example/priority-sdk",
    number: 42,
    title: "Add support for NextOS 13",
    body: "Needed for the next release.",
    url: "https://example.invalid/owner-example/priority-sdk/pull/42",
    author: "external_contributor_1",
    authorAssociation: "FIRST_TIME_CONTRIBUTOR",
    affiliation: undefined,
    state: "open",
    isDraft: false,
    baseBranch: "main",
    headBranch: "feature/nextos-13",
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-10T00:00:00Z",
    additions: 20,
    deletions: 5,
    changedLines: 25,
    changedFiles: 2,
    fileTypes: ["ts"],
    directories: ["src"],
    labels: ["compatibility"],
    issueCommentCount: 1,
    reviewCommentCount: 0,
    approvals: 1,
    reviewRequests: [],
    requestedReviewTeams: [],
    ownershipMatch: "none",
    unresolvedConversationCount: undefined,
    maintainerBlocking: false,
    authorRespondedRecently: true,
    ciState: "passing",
    failingChecks: 0,
    mergeable: "mergeable",
    requiredReviewsComplete: true,
    branchBehindBase: false,
    readyForReview: true,
    ageDays: 12,
    daysSinceLastUpdate: 2,
    daysSinceLastMaintainerInteraction: 2,
    daysSinceLastAuthorInteraction: 2,
    linkedIssues: [],
    urgencySignals: [],
    dependencySignals: ["release"],
    businessSignals: ["text-signal"],
    lowHangingFruit: false,
    lowHangingReasons: [],
    riskReasons: [],
    ...overrides,
  };
}

test("compatibility PRs can surface as quick wins", () => {
  const scored = scorePullRequest(makeBasePr(), DEFAULT_CONFIG);
  assert.ok(["Quick Wins", "Pick Next"].includes(scored.recommendationBucket));
  assert.ok(scored.finalScore >= DEFAULT_CONFIG.codeJamThresholds.quickWinMinScore);
});

test("routine maintenance PRs are deprioritized", () => {
  const scored = scorePullRequest(
    makeBasePr({
      title: "Configure dependency maintenance automation",
      body: "maintenance workflow update",
      author: "automation-bot[bot]",
      authorAssociation: "NONE",
      labels: ["maintenance", "automation"],
      businessSignals: [],
      dependencySignals: [],
      urgencySignals: [],
    }),
    DEFAULT_CONFIG,
  );

  assert.equal(scored.recommendationBucket, "Probably Deprioritize for Code Jam");
  assert.ok(scored.tags.includes("not-code-jam-friendly"));
});

test("top merge-ready quick wins can be promoted into pick next", () => {
  const config = {
    ...DEFAULT_CONFIG,
    codeJamThresholds: {
      ...DEFAULT_CONFIG.codeJamThresholds,
      pickNextTargetCount: 2,
    },
  };

  const quickWinA = scorePullRequest(
    makeBasePr({
      number: 1,
      title: "Add support for CloudOS 24.04",
      url: "https://example.invalid/owner-example/priority-sdk/pull/1",
    }),
    config,
  );
  const quickWinB = scorePullRequest(
    makeBasePr({
      number: 2,
      title: "Add support for ServerOS 9",
      url: "https://example.invalid/owner-example/priority-sdk/pull/2",
      changedLines: 40,
      changedFiles: 3,
      approvals: 0,
      requiredReviewsComplete: false,
    }),
    config,
  );

  quickWinA.recommendationBucket = "Quick Wins";
  quickWinA.tags = quickWinA.tags.filter((tag) => tag !== "pick-next");
  quickWinB.recommendationBucket = "Quick Wins";
  quickWinB.tags = quickWinB.tags.filter((tag) => tag !== "pick-next");

  const promoted = promotePickNextCandidates([quickWinA, quickWinB], config);

  assert.equal(promoted.filter((pr) => pr.recommendationBucket === "Pick Next").length, 2);
  assert.ok(promoted.every((pr) => pr.tags.includes("pick-next")));
});
