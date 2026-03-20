import { GITHUB_API_URL } from "./constants.js";
import { AuthMode, Logger } from "./types.js";
import { runCommand } from "./utils.js";

const TOKEN_ENV_NAMES = ["GITHUB_TOKEN", "GH_TOKEN", "GITHUB_PAT"];

async function verifyToken(token: string): Promise<boolean> {
  const response = await fetch(`${GITHUB_API_URL}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "pr-prioritization-assistant",
    },
  });
  return response.ok;
}

export async function checkGitAvailability(): Promise<boolean> {
  const result = await runCommand("git", ["--version"]);
  return result.exitCode === 0;
}

export async function detectAuth(logger: Logger): Promise<AuthMode> {
  const ghVersion = await runCommand("gh", ["--version"]);
  if (ghVersion.exitCode === 0) {
    logger.verbose("`gh` CLI detected.");
    const authStatus = await runCommand("gh", ["auth", "status"]);
    if (authStatus.exitCode === 0) {
      const tokenResult = await runCommand("gh", ["auth", "token"]);
      const token = tokenResult.stdout.trim();
      if (token && (await verifyToken(token))) {
        return {
          mode: "gh",
          label: "Using GitHub CLI authentication",
          token,
        };
      }
    }
  }

  for (const envName of TOKEN_ENV_NAMES) {
    const token = process.env[envName]?.trim();
    if (token && (await verifyToken(token))) {
      return {
        mode: "token",
        label: "Using token-based API authentication",
        token,
      };
    }
  }

  throw new Error(
    "No valid GitHub authentication path was found. Authenticate with `gh auth login`, set `GITHUB_TOKEN`, and verify network access.",
  );
}
