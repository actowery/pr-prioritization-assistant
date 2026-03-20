export const COMMON_CODEOWNERS_PATHS = [
  ".github/CODEOWNERS",
  "CODEOWNERS",
  "docs/CODEOWNERS",
] as const;

export interface CodeownersEntry {
  pattern: string;
  owners: string[];
}

const AUTO_DEEP_REPO_THRESHOLD = 100;

export function normalizeCodeownersTeam(org: string, team: string): string {
  const trimmedOrg = org.trim().replace(/^@/, "").replace(/\/+$/, "");
  const trimmedTeam = team.trim();

  if (!trimmedOrg) {
    throw new Error("CODEOWNERS org cannot be empty.");
  }

  if (!trimmedTeam) {
    throw new Error("CODEOWNERS team cannot be empty.");
  }

  const normalized = trimmedTeam.replace(/^@/, "");
  const teamPath = normalized.includes("/") ? normalized : `${trimmedOrg}/${normalized}`;
  return `@${teamPath.toLowerCase()}`;
}

export function codeownersMentionsTeam(content: string, normalizedTeam: string): boolean {
  const normalizedContent = content.toLowerCase();
  return normalizedContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .some((line) => line.includes(normalizedTeam));
}

export function decodeBase64Content(content: string): string {
  return Buffer.from(content.replace(/\s+/g, ""), "base64").toString("utf8");
}

export function buildCodeownersSearchQuery(org: string, team: string): string {
  const normalizedTeam = normalizeCodeownersTeam(org, team);
  return `org:${org.trim()} filename:CODEOWNERS "${normalizedTeam}"`;
}

export function selectCodeownersDiscoveryMode(
  requestedMode: "auto" | "search" | "deep",
  options: {
    orgRepoCount?: number | undefined;
    repoLimit?: number | undefined;
  },
): "search" | "deep" {
  if (requestedMode === "search" || requestedMode === "deep") {
    return requestedMode;
  }

  if (options.repoLimit && options.repoLimit <= AUTO_DEEP_REPO_THRESHOLD) {
    return "deep";
  }

  if (options.orgRepoCount !== undefined && options.orgRepoCount <= AUTO_DEEP_REPO_THRESHOLD) {
    return "deep";
  }

  return "search";
}

export function normalizeRequestedTeamRef(org?: string, slug?: string): string | undefined {
  const normalizedOrg = org?.trim();
  const normalizedSlug = slug?.trim();

  if (!normalizedOrg || !normalizedSlug) {
    return undefined;
  }

  return `@${normalizedOrg.toLowerCase()}/${normalizedSlug.toLowerCase()}`;
}

export function deriveTeamOwnershipMatch(
  requestedReviewUsers: string[],
  requestedReviewTeams: string[],
  normalizedTeam: string,
  teamMembers: Set<string>,
): "requested-team" | "requested-team-member" | "none" {
  if (requestedReviewTeams.includes(normalizedTeam)) {
    return "requested-team";
  }

  if (requestedReviewUsers.some((user) => teamMembers.has(user))) {
    return "requested-team-member";
  }

  return "none";
}

export function parseCodeownersEntries(content: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const [pattern, ...owners] = line.split(/\s+/);
    if (!pattern || owners.length === 0) {
      continue;
    }

    entries.push({
      pattern,
      owners: owners.map((owner) => owner.toLowerCase()),
    });
  }

  return entries;
}

export function matchCodeownersPaths(
  entries: CodeownersEntry[],
  filePaths: string[],
  normalizedTeam: string,
): boolean {
  return filePaths.some((filePath) => {
    const owners = findOwnersForPath(entries, filePath);
    return owners.includes(normalizedTeam);
  });
}

export function findOwnersForPath(entries: CodeownersEntry[], filePath: string): string[] {
  const normalizedPath = normalizeRepoPath(filePath);
  let owners: string[] = [];

  for (const entry of entries) {
    if (codeownersPatternMatches(entry.pattern, normalizedPath)) {
      owners = entry.owners;
    }
  }

  return owners;
}

function codeownersPatternMatches(pattern: string, filePath: string): boolean {
  const normalizedPattern = normalizeCodeownersPattern(pattern);
  const regex = globLikePatternToRegex(normalizedPattern);
  return regex.test(filePath);
}

function normalizeRepoPath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeCodeownersPattern(pattern: string): string {
  let normalized = pattern.trim().replace(/\\/g, "/");
  const anchored = normalized.startsWith("/");
  normalized = normalized.replace(/^\/+/, "");

  if (normalized.endsWith("/")) {
    normalized = `${normalized}**`;
  }

  if (!normalized.includes("/")) {
    normalized = `**/${normalized}`;
  } else if (!anchored) {
    normalized = `**/${normalized}`;
  }

  return normalized;
}

function globLikePatternToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/__DOUBLE_STAR__/g, ".*");

  return new RegExp(`^${regexSource}$`, "i");
}
