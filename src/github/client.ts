import { GITHUB_API_URL } from "../constants.js";
import { CodeownersDiscoveryMode, IssueAnalysis, Logger, OwnershipMode, PullRequestAnalysis, RepoRef } from "../types.js";
import {
  buildCodeownersSearchQuery,
  codeownersMentionsTeam,
  COMMON_CODEOWNERS_PATHS,
  decodeBase64Content,
  deriveTeamOwnershipMatch,
  matchCodeownersPaths,
  normalizeCodeownersTeam,
  normalizeRequestedTeamRef,
  parseCodeownersEntries,
  selectCodeownersDiscoveryMode,
} from "./codeowners.js";
import {
  daysBetween,
  directoryForPath,
  extensionForPath,
  mapLimit,
  normalizeLabel,
  unique,
} from "../utils.js";

interface GitHubClientOptions {
  token: string;
  logger: Logger;
  verbose?: boolean;
}

interface PullSummary {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  draft: boolean;
  created_at: string;
  updated_at: string;
  user?: { login?: string; type?: string } | null;
  base: { ref: string };
}

interface PullDetail {
  additions: number;
  deletions: number;
  changed_files: number;
  comments?: number;
  review_comments?: number;
  mergeable: boolean | null;
  mergeable_state?: string;
  draft: boolean;
  title: string;
  body?: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  base: { ref: string };
  head: { ref: string; sha: string };
  user?: { login?: string; type?: string } | null;
  requested_reviewers?: Array<{ login?: string }>;
}

interface IssueDetail {
  labels?: Array<{ name?: string }>;
  comments?: number;
  updated_at?: string;
  body?: string | null;
  author_association?: string;
}

interface Review {
  state?: string;
  submitted_at?: string | null;
  user?: { login?: string } | null;
}

interface RequestedReviewerTeam {
  slug?: string;
  organization?: { login?: string } | null;
}

interface RequestedReviewersResponse {
  users?: Array<{ login?: string }>;
  teams?: RequestedReviewerTeam[];
}

interface PullFile {
  filename: string;
}

interface CombinedStatus {
  state?: string;
  statuses?: Array<{ state?: string }>;
}

interface OrgRepoSummary {
  name: string;
  full_name: string;
  archived?: boolean;
  disabled?: boolean;
  owner?: { login?: string } | null;
}

interface RepoContentFile {
  type?: string;
  content?: string;
  encoding?: string;
}

interface OrgSummary {
  public_repos?: number;
  total_private_repos?: number;
  owned_private_repos?: number;
}

interface CodeSearchResultItem {
  repository?: {
    full_name?: string;
    name?: string;
    owner?: { login?: string } | null;
    archived?: boolean;
  } | null;
}

interface CodeSearchResponse {
  total_count?: number;
  incomplete_results?: boolean;
  items?: CodeSearchResultItem[];
}

interface TeamMember {
  login?: string;
}

interface TeamReviewContext {
  normalizedTeam: string;
  teamMembers: Set<string>;
}

type AssignedOwnershipMatch = "requested-team" | "requested-team-member" | "none";

interface IssueSummary {
  number: number;
  title: string;
  body?: string | null;
  html_url: string;
  state: string;
  created_at: string;
  updated_at: string;
  user?: { login?: string; type?: string } | null;
  author_association?: string;
  labels?: Array<{ name?: string }>;
  assignees?: Array<{ login?: string }>;
  comments?: number;
  milestone?: { title?: string } | null;
  pull_request?: unknown;
  reactions?: { total_count?: number } | null;
}

export type RawIssueAnalysis = Omit<
  IssueAnalysis,
  | "businessRelevanceScore"
  | "unblockValueScore"
  | "triageReadinessScore"
  | "effortToResolveScore"
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

export class GitHubClient {
  private readonly token: string;
  private readonly logger: Logger;
  private readonly verbose: boolean;
  private rateLimitedUntil?: number;
  private readonly requestCache = new Map<string, Promise<unknown>>();

  constructor(options: GitHubClientOptions) {
    this.token = options.token;
    this.logger = options.logger;
    this.verbose = options.verbose ?? false;
  }

  private async request<T>(path: string): Promise<T> {
    const cached = this.requestCache.get(path);
    if (cached) {
      return cached as Promise<T>;
    }

    const requestPromise = this.performRequest<T>(path);
    this.requestCache.set(path, requestPromise as Promise<unknown>);

    try {
      return await requestPromise;
    } catch (error) {
      this.requestCache.delete(path);
      throw error;
    }
  }

  private async performRequest<T>(path: string): Promise<T> {
    if (this.rateLimitedUntil && Date.now() < this.rateLimitedUntil) {
      throw new RateLimitError(this.rateLimitedUntil, path);
    }

    const response = await fetch(`${GITHUB_API_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "pr-prioritization-assistant",
      },
    });

    if (this.verbose) {
      this.logger.verbose(`GET ${path} -> ${response.status}`);
    }

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 403 && body.includes("API rate limit exceeded")) {
        const resetHeader = response.headers.get("x-ratelimit-reset");
        const resetAt = resetHeader ? Number.parseInt(resetHeader, 10) * 1000 : Date.now() + 60_000;
        this.rateLimitedUntil = Number.isFinite(resetAt) ? resetAt : Date.now() + 60_000;
        throw new RateLimitError(this.rateLimitedUntil, path);
      }
      throw new Error(`GitHub API request failed for ${path}: ${response.status} ${body}`);
    }

    return (await response.json()) as T;
  }

  private async requestOptional<T>(path: string, fallback: T): Promise<T> {
    try {
      return await this.request<T>(path);
    } catch (error) {
      if (error instanceof RateLimitError) {
        this.logger.warn(error.message);
        return fallback;
      }
      if (this.verbose) {
        this.logger.verbose(`Optional request failed for ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return fallback;
    }
  }

  async validateRepoAccess(repo: RepoRef): Promise<void> {
    await this.request(`/repos/${repo.owner}/${repo.repo}`);
  }

  async fetchOpenPrSummaries(repo: RepoRef, limit?: number, baseBranch?: string): Promise<PullSummary[]> {
    const perPage = Math.min(limit ?? 100, 100);
    const query = new URLSearchParams({
      state: "open",
      per_page: String(perPage),
    });
    if (baseBranch) {
      query.set("base", baseBranch);
    }
    return this.request<PullSummary[]>(`/repos/${repo.owner}/${repo.repo}/pulls?${query.toString()}`);
  }

  async repoHasOpenPullRequests(repo: RepoRef, baseBranch?: string): Promise<boolean> {
    const summaries = await this.fetchOpenPrSummaries(repo, 1, baseBranch);
    return summaries.length > 0;
  }

  async fetchPullRequestAnalysis(
    repo: RepoRef,
    summary: PullSummary,
    affiliationMap: Record<string, string>,
    teamReviewContext?: TeamReviewContext,
    ownershipMode: OwnershipMode = "either",
  ): Promise<RawPullRequestAnalysis> {
    const pullDetail = await this.request<PullDetail>(`/repos/${repo.owner}/${repo.repo}/pulls/${summary.number}`);

    const [issueDetail, reviews, files, status, requestedReviewers] = await Promise.all([
      this.request<IssueDetail>(`/repos/${repo.owner}/${repo.repo}/issues/${summary.number}`),
      this.requestOptional<Review[]>(
        `/repos/${repo.owner}/${repo.repo}/pulls/${summary.number}/reviews?per_page=100`,
        [],
      ),
      this.requestOptional<PullFile[]>(
        `/repos/${repo.owner}/${repo.repo}/pulls/${summary.number}/files?per_page=100`,
        [],
      ),
      this.requestOptional<CombinedStatus>(
        `/repos/${repo.owner}/${repo.repo}/commits/${pullDetail.head.sha}/status`,
        { state: "unknown", statuses: [] },
      ),
      this.requestOptional<RequestedReviewersResponse>(
        `/repos/${repo.owner}/${repo.repo}/pulls/${summary.number}/requested_reviewers`,
        { users: pullDetail.requested_reviewers ?? [], teams: [] },
      ),
    ]);

    const author = pullDetail.user?.login ?? "unknown";
    const labels = (issueDetail.labels ?? [])
      .map((label) => label.name?.trim())
      .filter((label): label is string => Boolean(label));
    const approvals = reviews.filter((review) => review.state === "APPROVED").length;
    const businessSignals = detectBusinessSignals(pullDetail.title, pullDetail.body ?? "", labels);
    const dependencySignals = detectDependencySignals(pullDetail.title, pullDetail.body ?? "");
    const urgencySignals = detectUrgencySignals(pullDetail.title, pullDetail.body ?? "");
    const fileTypes = unique(
      files.map((file) => extensionForPath(file.filename)).filter((value): value is string => Boolean(value)),
    );
    const directories = unique(
      files.map((file) => directoryForPath(file.filename)).filter((value): value is string => Boolean(value)),
    );
    const changedLines = pullDetail.additions + pullDetail.deletions;
    const ciState = deriveCiState(status);
    const failingChecks = (status.statuses ?? []).filter((entry) => entry.state === "failure").length;
    const mergeable = pullDetail.mergeable === null
      ? "unknown"
      : pullDetail.mergeable
        ? "mergeable"
        : "conflicting";
    const requiredReviewsComplete =
      approvals > 0 || labels.some((label) => normalizeLabel(label).includes("approved"));
    const linkedIssues = detectLinkedIssues(pullDetail.body ?? "");
    const maintainerBlocking = reviews.some((review) => review.state === "CHANGES_REQUESTED");
    const authorRespondedRecently = daysBetween(pullDetail.updated_at) <= 7;
    const requestedReviewUsers = unique(
      (requestedReviewers.users ?? [])
        .map((reviewer) => reviewer.login)
        .filter((value): value is string => Boolean(value)),
    );
    const requestedReviewTeams = unique(
      (requestedReviewers.teams ?? [])
        .map((team) => normalizeRequestedTeam(team))
        .filter((value): value is string => Boolean(value)),
    );
    const assignedOwnershipMatch = deriveAssignedOwnershipMatch(
      requestedReviewUsers,
      requestedReviewTeams,
      teamReviewContext,
    );
    const codeownersContent = teamReviewContext
      ? await this.fetchCodeownersContent(repo)
      : undefined;
    const touchedPathMatch = teamReviewContext && codeownersContent
      ? matchCodeownersPaths(
          parseCodeownersEntries(codeownersContent),
          files.map((file) => file.filename),
          teamReviewContext.normalizedTeam,
        )
      : false;
    const ownershipMatch = combineOwnershipMatch(assignedOwnershipMatch, touchedPathMatch);

    if (ownershipMatch !== "none") {
      businessSignals.push("team-review-request");
    }

    return {
      repo: repo.fullName,
      repoOwner: repo.owner,
      repoName: repo.repo,
      repoUrl: `https://github.com/${repo.fullName}`,
      number: summary.number,
      title: pullDetail.title,
      body: pullDetail.body ?? "",
      url: pullDetail.html_url,
      author,
      authorAssociation: issueDetail.author_association,
      affiliation: affiliationMap[author],
      state: "open",
      isDraft: pullDetail.draft,
      baseBranch: pullDetail.base.ref,
      headBranch: pullDetail.head.ref,
      createdAt: pullDetail.created_at,
      updatedAt: pullDetail.updated_at,
      additions: pullDetail.additions,
      deletions: pullDetail.deletions,
      changedLines,
      changedFiles: pullDetail.changed_files,
      fileTypes,
      directories,
      labels,
      issueCommentCount: issueDetail.comments ?? pullDetail.comments ?? 0,
      reviewCommentCount: pullDetail.review_comments ?? 0,
      approvals,
      reviewRequests: requestedReviewUsers,
      requestedReviewTeams,
      ownershipMatch,
      unresolvedConversationCount: undefined,
      maintainerBlocking,
      authorRespondedRecently,
      ciState,
      failingChecks,
      mergeable,
      requiredReviewsComplete,
      branchBehindBase: pullDetail.mergeable_state === "behind",
      readyForReview: !pullDetail.draft,
      ageDays: daysBetween(pullDetail.created_at),
      daysSinceLastUpdate: daysBetween(pullDetail.updated_at),
      daysSinceLastMaintainerInteraction: undefined,
      daysSinceLastAuthorInteraction: daysBetween(pullDetail.updated_at),
      linkedIssues,
      urgencySignals,
      dependencySignals,
      businessSignals,
      lowHangingFruit: false,
      lowHangingReasons: [],
      riskReasons: deriveRiskReasons(files, pullDetail, ownershipMode, ownershipMatch),
    };
  }

  async fetchRepoAnalyses(
    repo: RepoRef,
    options: {
      maxPrsPerRepo?: number | undefined;
      baseBranch?: string | undefined;
      includeDrafts: boolean;
      excludeDrafts: boolean;
      affiliationMap: Record<string, string>;
      teamReviewContext?: TeamReviewContext | undefined;
      ownershipMode?: OwnershipMode | undefined;
    },
  ): Promise<RawPullRequestAnalysis[]> {
    const summaries = await this.fetchOpenPrSummaries(repo, options.maxPrsPerRepo, options.baseBranch);
    const filtered = summaries.filter((summary) => {
      if (options.excludeDrafts && summary.draft) {
        return false;
      }
      if (!options.includeDrafts && summary.draft) {
        return false;
      }
      return true;
    });

    const analyses = await mapLimit(filtered, 2, async (summary) =>
      this.fetchPullRequestAnalysis(
        repo,
        summary,
        options.affiliationMap,
        options.teamReviewContext,
        options.ownershipMode ?? "either",
      ),
    );

    if (!options.teamReviewContext) {
      return analyses;
    }

    return analyses.filter((analysis) => matchesOwnershipMode(analysis.ownershipMatch, options.ownershipMode ?? "either"));
  }

  async buildTeamReviewContext(org: string, team: string): Promise<TeamReviewContext> {
    const normalizedTeam = normalizeCodeownersTeam(org, team);
    const teamSlug = normalizedTeam.split("/")[1]?.replace(/^@/, "") ?? team;
    const teamMembers = new Set(
      await this.fetchTeamMembers(org, teamSlug),
    );

    return {
      normalizedTeam,
      teamMembers,
    };
  }

  async discoverReposByCodeowners(
    org: string,
    team: string,
    options: {
      mode?: CodeownersDiscoveryMode | undefined;
      includeArchived?: boolean | undefined;
      onlyWithOpenPrs?: boolean | undefined;
      baseBranch?: string | undefined;
      repoLimit?: number | undefined;
    } = {},
  ): Promise<RepoRef[]> {
    const orgRepoCount = await this.fetchOrgRepoCount(org);
    const mode = selectCodeownersDiscoveryMode(options.mode ?? "auto", {
      orgRepoCount,
      repoLimit: options.repoLimit,
    });

    this.logger.info(`Using CODEOWNERS discovery mode: ${mode}`);

    const matches = mode === "search"
      ? await this.discoverReposByCodeownersSearch(org, team, options)
      : await this.discoverReposByCodeownersDeep(org, team, options);

    if (!options.onlyWithOpenPrs) {
      return matches;
    }

    const withOpenPrs = await mapLimit(matches, 4, async (repo) =>
      (await this.repoHasOpenPullRequests(repo, options.baseBranch)) ? repo : undefined,
    );

    return withOpenPrs.filter((repo): repo is RepoRef => Boolean(repo));
  }

  private async fetchOrgRepoCount(org: string): Promise<number | undefined> {
    const summary = await this.requestOptional<OrgSummary | undefined>(`/orgs/${org}`, undefined);
    if (!summary) {
      return undefined;
    }

    const publicRepos = summary.public_repos ?? 0;
    const privateRepos = summary.total_private_repos ?? summary.owned_private_repos ?? 0;
    const total = publicRepos + privateRepos;
    return total > 0 ? total : undefined;
  }

  private async fetchOrgRepos(org: string, repoLimit?: number): Promise<OrgRepoSummary[]> {
    const perPage = 100;
    const repos: OrgRepoSummary[] = [];
    let page = 1;

    while (true) {
      const batch = await this.request<OrgRepoSummary[]>(
        `/orgs/${org}/repos?per_page=${perPage}&page=${page}&type=all`,
      );
      repos.push(...batch);

      if (batch.length < perPage || (repoLimit && repos.length >= repoLimit)) {
        break;
      }
      page += 1;
    }

    return repoLimit ? repos.slice(0, repoLimit) : repos;
  }

  private async fetchTeamMembers(org: string, teamSlug: string): Promise<string[]> {
    const members: string[] = [];
    let page = 1;

    while (true) {
      const batch = await this.requestOptional<TeamMember[]>(
        `/orgs/${org}/teams/${teamSlug}/members?per_page=100&page=${page}`,
        [],
      );
      members.push(
        ...batch
          .map((member) => member.login)
          .filter((value): value is string => Boolean(value)),
      );

      if (batch.length < 100) {
        break;
      }

      page += 1;
    }

    return unique(members);
  }

  private async discoverReposByCodeownersDeep(
    org: string,
    team: string,
    options: {
      includeArchived?: boolean | undefined;
      repoLimit?: number | undefined;
    },
  ): Promise<RepoRef[]> {
    const repos = await this.fetchOrgRepos(org, options.repoLimit);
    const normalizedTeam = normalizeCodeownersTeam(org, team);
    const eligibleRepos = repos.filter((repo) => !repo.disabled && (options.includeArchived || !repo.archived));

    const matches = await mapLimit(eligibleRepos, 4, async (repo) => {
      const found = await this.repoHasMatchingCodeowners(repo, normalizedTeam);
      return found
        ? {
            owner: repo.owner?.login ?? org,
            repo: repo.name,
            fullName: repo.full_name,
          }
        : undefined;
    });

    return matches.filter((repo): repo is RepoRef => Boolean(repo));
  }

  private async discoverReposByCodeownersSearch(
    org: string,
    team: string,
    options: {
      includeArchived?: boolean | undefined;
      repoLimit?: number | undefined;
    },
  ): Promise<RepoRef[]> {
    const query = buildCodeownersSearchQuery(org, team);
    const matches: RepoRef[] = [];
    const seen = new Set<string>();
    let page = 1;

    while (page <= 10) {
      const encodedQuery = encodeURIComponent(query);
      const response = await this.request<CodeSearchResponse>(
        `/search/code?q=${encodedQuery}&per_page=100&page=${page}`,
      );
      const items = response.items ?? [];

      for (const item of items) {
        const repo = item.repository;
        const fullName = repo?.full_name;
        const owner = repo?.owner?.login;
        const repoName = repo?.name;

        if (!fullName || !owner || !repoName) {
          continue;
        }

        if (!options.includeArchived && repo.archived) {
          continue;
        }

        if (seen.has(fullName)) {
          continue;
        }

        seen.add(fullName);
        matches.push({ owner, repo: repoName, fullName });

        if (options.repoLimit && matches.length >= options.repoLimit) {
          return matches;
        }
      }

      if (items.length < 100) {
        break;
      }

      page += 1;
    }

    return matches;
  }

  private async repoHasMatchingCodeowners(repo: OrgRepoSummary, normalizedTeam: string): Promise<boolean> {
    const content = await this.fetchCodeownersContent({
      owner: repo.owner?.login ?? "",
      repo: repo.name,
      fullName: repo.full_name,
    });
    if (!content) {
      return false;
    }
    return codeownersMentionsTeam(content, normalizedTeam);
  }

  private async fetchCodeownersContent(repo: RepoRef): Promise<string | undefined> {
    for (const path of COMMON_CODEOWNERS_PATHS) {
      const content = await this.requestOptional<RepoContentFile | undefined>(
        `/repos/${repo.fullName}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`,
        undefined,
      );

      if (!content || content.type !== "file" || content.encoding !== "base64" || !content.content) {
        continue;
      }

      return decodeBase64Content(content.content);
    }

    return undefined;
  }

  async fetchRepoIssues(
    repo: RepoRef,
    opts: { maxIssuesPerRepo?: number | undefined; affiliationMap: Record<string, string> },
  ): Promise<RawIssueAnalysis[]> {
    const limit = opts.maxIssuesPerRepo ?? 100;
    const items = await this.requestOptional<IssueSummary[]>(
      `/repos/${repo.owner}/${repo.repo}/issues?state=open&per_page=${Math.min(limit, 100)}&sort=updated&direction=desc`,
      [],
    );

    const issuesOnly = items.filter((item) => !item.pull_request);

    return issuesOnly.slice(0, limit).map((item): RawIssueAnalysis => {
      const body = item.body ?? "";
      const title = item.title ?? "";
      const labels = (item.labels ?? []).map((l) => normalizeLabel(l.name ?? "")).filter(Boolean);
      const assignees = (item.assignees ?? []).map((a) => a.login ?? "").filter(Boolean);
      const author = item.user?.login ?? "unknown";
      const authorAssociation = item.author_association;
      const affiliation = opts.affiliationMap[author];
      const createdAt = item.created_at;
      const updatedAt = item.updated_at;
      const ageDays = daysBetween(createdAt);
      const daysSinceLastUpdate = daysBetween(updatedAt);
      const repoUrl = `https://github.com/${repo.fullName}`;

      return {
        repo: repo.fullName,
        repoOwner: repo.owner,
        repoName: repo.repo,
        repoUrl,
        number: item.number,
        title,
        body,
        url: item.html_url,
        author,
        ...(authorAssociation !== undefined ? { authorAssociation } : {}),
        ...(affiliation !== undefined ? { affiliation } : {}),
        state: "open",
        createdAt,
        updatedAt,
        labels,
        assignees,
        commentCount: item.comments ?? 0,
        ...(item.milestone?.title !== undefined ? { milestone: item.milestone.title } : {}),
        linkedPrNumbers: detectLinkedPrNumbers(body),
        reactionCount: item.reactions?.total_count ?? 0,
        ageDays,
        daysSinceLastUpdate,
        urgencySignals: detectUrgencySignals(title, body),
        dependencySignals: detectDependencySignals(title, body),
        businessSignals: detectBusinessSignals(title, body, labels),
      };
    });
  }
}

function detectLinkedPrNumbers(body: string): number[] {
  const patterns = [
    /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implement[sd]?|in|pr|pull request)\s+#(\d+)/gi,
    /fixed by\s+#(\d+)/gi,
    /PR:\s+#?(\d+)/gi,
  ];
  const found = new Set<number>();
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) {
      const num = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isNaN(num)) {
        found.add(num);
      }
    }
  }
  return [...found];
}

function detectLinkedIssues(text: string): string[] {
  const matches = text.match(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?)\s+#\d+/gi) ?? [];
  return unique(matches.map((match) => match.trim()));
}

function detectBusinessSignals(title: string, body: string, labels: string[]): string[] {
  const haystack = `${title}\n${body}`.toLowerCase();
  const signals: string[] = [];
  const labelMatches = labels.filter((label) =>
    /(release|customer|support|security|compat|compatibility|blocker|urgent)/i.test(label),
  );
  signals.push(...labelMatches.map((label) => `label:${label}`));
  if (/major version|breaking change|customer|support case|security|release/.test(haystack)) {
    signals.push("text-signal");
  }
  return unique(signals);
}

function detectDependencySignals(title: string, body: string): string[] {
  const haystack = `${title}\n${body}`.toLowerCase();
  const patterns = [
    "blocks",
    "blocked by",
    "needed for",
    "required for",
    "unblock",
    "depends on",
    "release",
    "compatibility",
  ];
  return patterns.filter((pattern) => haystack.includes(pattern));
}

function detectUrgencySignals(title: string, body: string): string[] {
  const haystack = `${title}\n${body}`.toLowerCase();
  const patterns = ["urgent", "asap", "customer", "release blocker", "before release", "regression"];
  return patterns.filter((pattern) => haystack.includes(pattern));
}

function deriveCiState(status: CombinedStatus): "passing" | "failing" | "pending" | "unknown" {
  switch (status.state) {
    case "success":
      return "passing";
    case "failure":
    case "error":
      return "failing";
    case "pending":
      return "pending";
    default:
      return "unknown";
  }
}

function deriveRiskReasons(
  files: PullFile[],
  pullDetail: PullDetail,
  ownershipMode: OwnershipMode,
  ownershipMatch: RawPullRequestAnalysis["ownershipMatch"],
): string[] {
  const reasons: string[] = [];
  if (pullDetail.changed_files > 15) {
    reasons.push("large file count");
  }
  if (pullDetail.additions + pullDetail.deletions > 800) {
    reasons.push("large diff");
  }
  if (files.some((file) => /schema|migration|infra|core|security/i.test(file.filename))) {
    reasons.push("touches high-impact areas");
  }
  if ((pullDetail.comments ?? 0) + (pullDetail.review_comments ?? 0) > 15) {
    reasons.push("heavy discussion");
  }
  if (ownershipMode === "both" && ownershipMatch === "none") {
    reasons.push("missing ownership match");
  }
  return reasons;
}

class RateLimitError extends Error {
  readonly resetAt: number;

  constructor(resetAt: number, path: string) {
    const resetDate = new Date(resetAt).toISOString();
    super(`GitHub API rate limit reached while requesting ${path}. Reset after ${resetDate}.`);
    this.name = "RateLimitError";
    this.resetAt = resetAt;
  }
}

function normalizeRequestedTeam(team: RequestedReviewerTeam): string | undefined {
  return normalizeRequestedTeamRef(team.organization?.login, team.slug);
}

function deriveAssignedOwnershipMatch(
  requestedReviewUsers: string[],
  requestedReviewTeams: string[],
  teamReviewContext?: TeamReviewContext,
): AssignedOwnershipMatch {
  if (!teamReviewContext) {
    return "none";
  }

  return deriveTeamOwnershipMatch(
    requestedReviewUsers,
    requestedReviewTeams,
    teamReviewContext.normalizedTeam,
    teamReviewContext.teamMembers,
  );
}

function combineOwnershipMatch(
  assignedMatch: "requested-team" | "requested-team-member" | "none",
  touchedPathMatch: boolean,
): RawPullRequestAnalysis["ownershipMatch"] {
  if (assignedMatch === "requested-team" && touchedPathMatch) {
    return "requested-team+codeowners-path";
  }
  if (assignedMatch === "requested-team-member" && touchedPathMatch) {
    return "requested-team-member+codeowners-path";
  }
  if (touchedPathMatch) {
    return "codeowners-path";
  }
  return assignedMatch;
}

function matchesOwnershipMode(
  ownershipMatch: RawPullRequestAnalysis["ownershipMatch"],
  ownershipMode: OwnershipMode,
): boolean {
  const assigned = ownershipMatch === "requested-team" || ownershipMatch === "requested-team-member" ||
    ownershipMatch === "requested-team+codeowners-path" || ownershipMatch === "requested-team-member+codeowners-path";
  const touched = ownershipMatch === "codeowners-path" ||
    ownershipMatch === "requested-team+codeowners-path" || ownershipMatch === "requested-team-member+codeowners-path";

  switch (ownershipMode) {
    case "assigned":
      return assigned;
    case "touched":
      return touched;
    case "both":
      return assigned && touched;
    case "either":
    default:
      return assigned || touched;
  }
}
