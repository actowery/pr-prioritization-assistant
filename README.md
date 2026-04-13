# PR Prioritization Assistant

CLI tool that scans a provided repository list, analyzes open GitHub pull requests, and emits an explainable recommendation order for human review.

The assistant is intentionally advisory — it does not merge PRs, comment on PRs, or claim to know final business priority. It shows its work so a maintainer can validate or override the ranking quickly.

## Features

- Auth detection with clear failure guidance — prefers `gh` CLI, falls back to token-based auth
- Accepts repos from repeated `--repo`, text files, JSON arrays, or CSV files
- Discovers repos automatically from CODEOWNERS matches across a GitHub org
- `prioritize-issues` subcommand to score and bucket open GitHub issues (separate from the PR pipeline)
- `list-repos` subcommand to list CODEOWNERS-owned repos without running any scan
- Narrows CODEOWNERS runs by active review ownership, touched owned paths, or both
- Collects PR metadata, diff metrics, discussion activity, merge-readiness, freshness, and lightweight business or unblock signals
- Produces transparent subscores plus an overall ranking
- Emits Markdown, JSON, and CSV reports
- Handles partial repo failures without aborting the whole run

## Requirements

- Node.js 22+
- Git installed
- GitHub auth — see [Auth Behavior](#auth-behavior)

## Install

```bash
npm install
npm run build
```

To make `prioritize-prs` available as a normal shell command:

```bash
npm link
```

## GitHub Actions

This repo ships with a CI workflow that runs on Ubuntu, macOS, and Windows. It verifies typecheck, build, test compilation, test execution, `npm pack --dry-run`, and CLI help output.

Before enabling automated publishing, update the placeholder metadata in [package.json](./package.json): `repository.url`, `homepage`, `bugs.url`.

## Default Run Flow

The CLI prefers checked-in starter files from `./defaults/` and falls back to the project root for local overrides.

| Purpose | Default path | Root fallback |
|---|---|---|
| Repo list | `defaults/repos.csv` / `.txt` / `.json` | `repos.csv` / `.txt` / `.json` |
| Base dir | `defaults/base-dir.txt` | `base-dir.txt` |
| Weights | `defaults/weights.json` | `weights.json` |
| Repo weights | `defaults/repo_weights.json` | `repo_weights.json` |
| Affiliations | `defaults/affiliations.json` | `affiliations.json` |
| Low-hanging thresholds | `defaults/low_hanging_thresholds.json` | `low_hanging_thresholds.json` |
| Label rules | `defaults/label_rules.json` | `label_rules.json` |
| Code-jam thresholds | `defaults/code_jam_thresholds.json` | `code_jam_thresholds.json` |

The `defaults/` directory is checked in with fictional starter data. Root-level files are gitignored so real org data stays out of Git.

Normal repeat-use flow:

```bash
npm run build
npm run scan
```

Direct launchers:

- macOS / Linux: `./prioritize-prs`
- Windows: `.\prioritize-prs.cmd`

Dev mode (no rebuild needed):

```bash
npm run scan:dev
```

## Usage

```bash
# Explicit repos
prioritize-prs --repo owner-example/repo-one --repo owner-example/repo-two --format md

# From a file
npm run start -- --repos-file ./examples/repos.txt --output-dir ./out --format all

# CODEOWNERS discovery
prioritize-prs --org exampleorg --codeowners-team platform-core --ownership-mode either --format md

# Large-org discovery
prioritize-prs --org exampleorg --codeowners-team platform-core --codeowners-mode search --only-with-open-prs --repo-limit 500 --format md

# CSV with base-dir
prioritize-prs --base-dir-file ./examples/base-dir.txt --repos-csv repos.csv --repo-column repo --format md
```

### list-repos subcommand

List repos owned by a CODEOWNERS team without running a PR scan — useful for verifying coverage, building input lists, or auditing ownership:

```bash
# Plain list (one owner/repo per line)
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core

# JSON output
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --format json

# Save to file
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --output repos.txt

# Only repos with open PRs
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --only-with-open-prs
```

The repo count is printed to stderr so it does not pollute piped output. See [CLI Options](#cli-options) for the full flag reference.

### prioritize-issues subcommand

Score and bucket open GitHub issues using a 6-dimension scoring model. This is a separate pipeline from PR prioritization — you run one or the other, not both together:

```bash
# Single repo
node dist/index.js prioritize-issues --repo owner-example/repo-one --format all --output-dir ./out

# CODEOWNERS discovery
node dist/index.js prioritize-issues --org exampleorg --codeowners-team platform-core --only-with-open-prs --format md --output-dir ./out

# Limit issues fetched per repo
node dist/index.js prioritize-issues --repo owner-example/repo-one --max-issues-per-repo 50 --format md
```

Output files: `issue-priorities.md`, `issue-priorities.json`, `issue-priorities.csv`.

Buckets: `Act Now` → `Quick Triage` → `Important but Needs Scoping` → `Needs More Info` → `Deprioritize`

## Convenience Commands

```bash
npm run build
npm run scan
npm run scan:dev
npm run clean
npm run clean:reports
npm run test:build
npm test
```

macOS/Linux `make` aliases: `make build`, `make test`, `make scan`, `make clean`.

## CLI Options

### Default command (PR prioritization)

- `--repo owner/repo`
- `--repos-file <path>`
- `--repos-csv <path>`
- `--org <org>`
- `--codeowners-team <team>`
- `--codeowners-mode <auto|search|deep>`
- `--ownership-mode <assigned|touched|either|both>`
- `--include-archived`
- `--only-with-open-prs`
- `--repo-limit <number>`
- `--base-dir-file <path>`
- `--repo-column <name>`
- `--output-dir <path>`
- `--format json|md|csv|all`
- `--max-prs-per-repo N`
- `--exclude-drafts`
- `--include-drafts`
- `--base-branch main`
- `--weights-file path/to/weights.json`
- `--org-affiliation-map path/to/affiliations.json`
- `--repo-business-weight path/to/repo_weights.json`
- `--low-hanging-thresholds path/to/config.json`
- `--label-rules-file path/to/label_rules.json`
- `--code-jam-thresholds-file path/to/code_jam_thresholds.json`
- `--verbose`

### prioritize-issues subcommand

- `--repo owner/repo` (repeatable)
- `--repos-file <path>`
- `--repos-csv <path>`
- `--org <org>`
- `--codeowners-team <team>`
- `--codeowners-mode <auto|search|deep>`
- `--include-archived`
- `--only-with-open-prs`
- `--repo-limit <number>`
- `--base-dir-file <path>`
- `--repo-column <name>`
- `--output-dir <path>`
- `--format json|md|csv|all`
- `--max-issues-per-repo <number>`
- `--org-affiliation-map <path>`
- `--repo-business-weight <path>`
- `--issue-weights-file <path>`
- `--label-rules-file <path>`
- `--verbose`

### list-repos subcommand

- `--org <org>` (required)
- `--codeowners-team <team>` (required)
- `--codeowners-mode <auto|search|deep>`
- `--include-archived`
- `--only-with-open-prs`
- `--repo-limit <number>`
- `--format text|json|csv` (default: `text`)
- `--output <file>`
- `--verbose`

## Auth Behavior

1. Checks whether `gh` is available and runs a lightweight `gh auth status` check.
2. If authenticated, uses the GitHub CLI token.
3. Otherwise, falls back to `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_PAT`.
4. Exits non-zero with next steps if no valid auth is found.

The chosen mode is printed at runtime (`Using GitHub CLI authentication` / `Using token-based API authentication`).

## CODEOWNERS Discovery

When `--org` and `--codeowners-team` are supplied together, the CLI switches into repo-discovery mode. It checks `.github/CODEOWNERS`, `CODEOWNERS`, and `docs/CODEOWNERS` in each repo, keeping only repos that mention the requested team.

**Discovery modes:**

- `auto` — uses `deep` for small orgs, `search` for larger ones
- `search` — GitHub code search against `filename:CODEOWNERS`; preferred for large orgs
- `deep` — lists repos and probes CODEOWNERS paths one by one; exact but expensive

**Ownership narrowing** (PR prioritization only):

- `assigned` — PRs directly assigned to the team or a team member
- `touched` — PRs touching files owned by the team in CODEOWNERS
- `either` — union of both (default)
- `both` — intersection; strictest option

Team matching accepts a plain slug (`platform-core`) or a full reference (`@exampleorg/platform-core`).

### API demand

`search` mode: a handful of search requests (up to 10 pages × 100 results), then open-PR filtering and PR scanning on matched repos only.

`deep` mode: ~1 request per 100 repos for listing, up to 3 content requests per repo for CODEOWNERS checks. A 3,000-repo org implies ~9,000 lookups before scanning starts — use `search` for large orgs.

Recommended large-org pattern:

```bash
prioritize-prs --org exampleorg --codeowners-team platform-core --codeowners-mode search --only-with-open-prs
```

Use `--repo-limit` for smoke tests and early tuning runs.

## Reports

Generated reports include a ranked PR list with score breakdown, recommendation buckets (Pick Next / Quick Wins / Important but Heavy / Needs Clarification / Probably Deprioritize), repo summaries, and a confidence and caveat section.

## Configuration Files

Starter config files are in `examples/`: `weights.json`, `repo_weights.json`, `affiliations.json`, `low_hanging_thresholds.json`, `label_rules.json`, `code_jam_thresholds.json`, `repos.txt`, `repos.csv`, `base-dir.txt`. All inputs are fictional templates.

`affiliations.json` supports two formats:

```json
{ "maintainer_user_1": "internal-maintainer" }
```

```json
{
  "top_community_contributors": ["foo", "bar"],
  "vip_orgs": "vip_org_1, vip_org_2",
  "internal_staff": ["maintainer_user_1"]
}
```

If the same user appears in multiple categories, affiliations are joined into a single string.

The repo also ships a [`.github/CODEOWNERS`](./.github/CODEOWNERS) so the project can dogfood its own discovery behavior.

## Testing

See [TESTING.md](./TESTING.md) for automated test commands, smoke-test commands, and expected manual validation checks.

## Notes On Scoring

Default weighted formula:

| Dimension | Weight |
|---|---|
| Business / Strategic Relevance | `0.34` |
| Unblock Value | `0.22` |
| Merge Readiness | `0.18` |
| Effort / Review Cost | `0.12` |
| Staleness Signal | `0.09` |
| Community / Relationship Value | `0.05` |

Signals are inferred from metadata and text patterns — treat output as a queue-shortening aid, not an automatic decision.

The shipped defaults bias toward business relevance and unblock value over raw diff size, are conservative about low-hanging fruit, penalize maintenance churn, and still allow small merge-ready fixes to surface. The goal is a credible starting queue on a first run without much customization.

## Example Full Run

```bash
node dist/index.js --base-dir-file ./examples/base-dir.txt --repos-csv repos.csv --repo-column repo --repo-business-weight ./examples/repo_weights.json --org-affiliation-map ./examples/affiliations.json --weights-file ./examples/weights.json --low-hanging-thresholds ./examples/low_hanging_thresholds.json --label-rules-file ./examples/label_rules.json --code-jam-thresholds-file ./examples/code_jam_thresholds.json --output-dir ./out --format all
```

## Sample Output

- [sample markdown](./examples/sample-output/pr-priorities.md)
- [sample json](./examples/sample-output/pr-priorities.json)
- [sample csv](./examples/sample-output/pr-priorities.csv)
