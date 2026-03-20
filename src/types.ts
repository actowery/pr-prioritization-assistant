export type OutputFormat = "json" | "md" | "csv" | "all";
export type CodeownersDiscoveryMode = "auto" | "search" | "deep";
export type OwnershipMode = "assigned" | "touched" | "either" | "both";

export interface CliOptions {
  repos: string[];
  reposFile?: string | undefined;
  reposCsv?: string | undefined;
  org?: string | undefined;
  codeownersTeam?: string | undefined;
  codeownersMode: CodeownersDiscoveryMode;
  ownershipMode: OwnershipMode;
  includeArchived: boolean;
  onlyWithOpenPrs: boolean;
  repoLimit?: number | undefined;
  baseDirFile?: string | undefined;
  repoColumn?: string | undefined;
  outputDir: string;
  format: OutputFormat;
  maxPrsPerRepo?: number | undefined;
  excludeDrafts: boolean;
  includeDrafts: boolean;
  baseBranch?: string | undefined;
  weightsFile?: string | undefined;
  orgAffiliationMap?: string | undefined;
  repoBusinessWeight?: string | undefined;
  lowHangingThresholds?: string | undefined;
  labelRulesFile?: string | undefined;
  codeJamThresholdsFile?: string | undefined;
  verbose: boolean;
}

export interface ScoringWeights {
  businessRelevance: number;
  unblockValue: number;
  mergeReadiness: number;
  effortReviewCost: number;
  stalenessSignal: number;
  communityValue: number;
}

export interface LowHangingThresholds {
  maxChangedLines: number;
  maxFilesChanged: number;
  maxReviewComments: number;
  minAgeDays: number;
}

export interface ConfigBundle {
  weights: ScoringWeights;
  repoWeights: Record<string, number>;
  affiliationMap: Record<string, string>;
  lowHangingThresholds: LowHangingThresholds;
  labelRules: LabelRules;
  codeJamThresholds: CodeJamThresholds;
}

export interface LabelRules {
  businessLabels: string[];
  unblockLabels: string[];
  maintenanceLabels: string[];
  quickWinLabels: string[];
  customerLabels: string[];
}

export interface CodeJamThresholds {
  pickNextMinScore: number;
  pickNextFloorScore: number;
  pickNextTargetCount: number;
  pickNextFallbackMergeReadinessMin: number;
  pickNextFallbackEffortMin: number;
  quickWinMinScore: number;
  importantButHeavyBusinessScore: number;
  importantButHeavyEffortMax: number;
  highScoreThreshold: number;
  stalePrAgeDays: number;
  stalePrIdleDays: number;
}

export interface AuthMode {
  mode: "gh" | "token";
  label: string;
  token: string;
}

export interface RepoRef {
  owner: string;
  repo: string;
  fullName: string;
}

export interface Logger {
  info(message: string): void;
  verbose(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface FetchRepoResult {
  repo: RepoRef;
  pullRequests: PullRequestAnalysis[];
  error?: string | undefined;
}

export interface PullRequestAnalysis {
  repo: string;
  repoOwner: string;
  repoName: string;
  repoUrl: string;
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  authorAssociation?: string | undefined;
  affiliation?: string | undefined;
  state: string;
  isDraft: boolean;
  baseBranch: string;
  headBranch: string;
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedLines: number;
  changedFiles: number;
  fileTypes: string[];
  directories: string[];
  labels: string[];
  issueCommentCount: number;
  reviewCommentCount: number;
  approvals: number;
  reviewRequests: string[];
  requestedReviewTeams: string[];
  ownershipMatch:
    | "requested-team"
    | "requested-team-member"
    | "codeowners-path"
    | "requested-team+codeowners-path"
    | "requested-team-member+codeowners-path"
    | "none";
  unresolvedConversationCount?: number | undefined;
  maintainerBlocking: boolean;
  authorRespondedRecently: boolean;
  ciState: "passing" | "failing" | "pending" | "unknown";
  failingChecks: number;
  mergeable: "mergeable" | "conflicting" | "unknown";
  requiredReviewsComplete: boolean;
  branchBehindBase?: boolean | undefined;
  readyForReview: boolean;
  ageDays: number;
  daysSinceLastUpdate: number;
  daysSinceLastMaintainerInteraction?: number | undefined;
  daysSinceLastAuthorInteraction?: number | undefined;
  linkedIssues: string[];
  urgencySignals: string[];
  dependencySignals: string[];
  businessSignals: string[];
  lowHangingFruit: boolean;
  lowHangingReasons: string[];
  riskReasons: string[];
  businessRelevanceScore: number;
  unblockValueScore: number;
  mergeReadinessScore: number;
  effortReviewCostScore: number;
  stalenessSignalScore: number;
  communityValueScore: number;
  repoStrategicMultiplier: number;
  finalScore: number;
  tags: string[];
  recommendationBucket:
    | "Pick Next"
    | "Quick Wins"
    | "Important but Heavy"
    | "Needs Clarification"
    | "Probably Deprioritize for Code Jam";
  explanation: string[];
  caveats: string[];
  confidence: "high" | "medium" | "low";
}

export interface RepoSummary {
  repo: string;
  totalOpenPrs: number;
  highScorePrs: number;
  stalePrs: number;
  lowHangingFruitPrs: number;
  quickWinsPrs: number;
  pickNextPrs: number;
  recommendedTopPr?: {
    number: number;
    title: string;
    url: string;
    score: number;
  } | undefined;
}

export interface RunSummary {
  scannedRepos: number;
  reachableRepos: number;
  totalPrs: number;
  pickNextCount: number;
  quickWinsCount: number;
  importantButHeavyCount: number;
  needsClarificationCount: number;
  deprioritizeCount: number;
  lowHangingFruitCount: number;
  partialFailures: Array<{ repo: string; error: string }>;
  authModeLabel: string;
}

export interface FullReport {
  generatedAt: string;
  summary: RunSummary;
  recommendationGroups: RecommendationGroups;
  repoSummaries: RepoSummary[];
  pullRequests: PullRequestAnalysis[];
  caveats: string[];
}

export interface RecommendationGroups {
  pickNext: PullRequestAnalysis[];
  quickWins: PullRequestAnalysis[];
  importantButHeavy: PullRequestAnalysis[];
  needsClarification: PullRequestAnalysis[];
  probablyDeprioritize: PullRequestAnalysis[];
}
