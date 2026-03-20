import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/reporting/reporters.js";
import { FullReport, PullRequestAnalysis } from "../src/types.js";

function makePullRequest(overrides: Partial<PullRequestAnalysis> = {}): PullRequestAnalysis {
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
    lowHangingFruit: true,
    lowHangingReasons: ["small diff"],
    riskReasons: [],
    businessRelevanceScore: 7,
    unblockValueScore: 5,
    mergeReadinessScore: 9,
    effortReviewCostScore: 9,
    stalenessSignalScore: 7,
    communityValueScore: 2,
    repoStrategicMultiplier: 1,
    finalScore: 6.2,
    tags: ["pick-next"],
    recommendationBucket: "Pick Next",
    explanation: ["Looks good."],
    caveats: [],
    confidence: "medium",
    ...overrides,
  };
}

function makeReport(overrides: Partial<FullReport> = {}): FullReport {
  return {
    generatedAt: "2026-03-20T00:00:00.000Z",
    summary: {
      scannedRepos: 2,
      reachableRepos: 1,
      totalPrs: 1,
      pickNextCount: 1,
      quickWinsCount: 0,
      importantButHeavyCount: 0,
      needsClarificationCount: 0,
      deprioritizeCount: 0,
      lowHangingFruitCount: 1,
      partialFailures: [],
      authModeLabel: "Using GitHub CLI authentication",
    },
    recommendationGroups: {
      pickNext: [makePullRequest()],
      quickWins: [],
      importantButHeavy: [],
      needsClarification: [],
      probablyDeprioritize: [],
    },
    repoSummaries: [
      {
        repo: "owner-example/priority-sdk",
        totalOpenPrs: 1,
        highScorePrs: 1,
        stalePrs: 0,
        lowHangingFruitPrs: 1,
        quickWinsPrs: 0,
        pickNextPrs: 1,
        recommendedTopPr: {
          number: 42,
          title: "Add support for NextOS 13",
          url: "https://example.invalid/owner-example/priority-sdk/pull/42",
          score: 6.2,
        },
      },
    ],
    pullRequests: [makePullRequest()],
    caveats: ["These rankings are recommendations."],
    ...overrides,
  };
}

test("renderMarkdown calls out incomplete zero-result runs", () => {
  const markdown = renderMarkdown(
    makeReport({
      summary: {
        ...makeReport().summary,
        totalPrs: 0,
        pickNextCount: 0,
        lowHangingFruitCount: 0,
        partialFailures: [{ repo: "owner-example/priority-sdk", error: "rate limited" }],
      },
      recommendationGroups: {
        pickNext: [],
        quickWins: [],
        importantButHeavy: [],
        needsClarification: [],
        probablyDeprioritize: [],
      },
      repoSummaries: [],
      pullRequests: [],
      caveats: [
        "This report is incomplete. Rerun after the GitHub rate limit resets to get a meaningful ranking.",
      ],
    }),
  );

  assert.match(markdown, /Run quality: incomplete due to partial failures or rate limiting/);
  assert.match(markdown, /No PRs were available to rank in this run\./);
  assert.match(markdown, /No repos produced analyzable PRs in this run\./);
});

test("renderMarkdown includes ownership match in top recommendations", () => {
  const markdown = renderMarkdown(
    makeReport({
      pullRequests: [
        makePullRequest({
          ownershipMatch: "requested-team",
          requestedReviewTeams: ["@exampleorg/platform-core"],
        }),
      ],
      recommendationGroups: {
        pickNext: [
          makePullRequest({
            ownershipMatch: "requested-team",
            requestedReviewTeams: ["@exampleorg/platform-core"],
          }),
        ],
        quickWins: [],
        importantButHeavy: [],
        needsClarification: [],
        probablyDeprioritize: [],
      },
    }),
  );

  assert.match(markdown, /Ownership match: requested-team/);
});
