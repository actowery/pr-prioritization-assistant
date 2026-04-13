# PR Prioritization Assistant

CLI tool that scans a provided repository list, analyzes open GitHub pull requests, and emits an explainable recommendation order for human review.

The assistant is intentionally advisory:

- It does not merge PRs.
- It does not comment on PRs.
- It does not claim to know final business priority.
- It does show its work so a maintainer can validate or override the ranking quickly.

## Features

- Auth detection with clear failure guidance
- Prefers authenticated `gh` CLI, falls back to token-based API auth
- Accepts repos from repeated `--repo`, text files, JSON arrays, or CSV files
- Can discover repos automatically from CODEOWNERS matches across a GitHub org
- `list-repos` subcommand to list CODEOWNERS-owned repos without running a full PR scan
- Can narrow CODEOWNERS runs by active review ownership, touched owned paths, or both
- Collects PR metadata, diff metrics, discussion activity, merge-readiness, freshness, and lightweight business or unblock signals
- Produces transparent subscores plus an overall ranking
- Emits Markdown, JSON, and CSV reports
- Handles partial repo failures without aborting the whole run

## Requirements

- Node.js 22+
- Git installed
- One of:
  - `gh auth login` completed successfully
  - `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_PAT` set with GitHub API access

## Install

```bash
npm install
npm run build
```

## GitHub Actions

This repo ships with a GitHub Actions workflow suitable for a public CLI package:

- `CI`
  - Runs on pushes, pull requests, and manual dispatch
  - Tests on Ubuntu, macOS, and Windows
  - Verifies typecheck, build, test compilation, test execution, `npm pack --dry-run`, and CLI help output

Before enabling automated publishing in the future, update the placeholder repository metadata in [package.json](./package.json):

- `repository.url`
- `homepage`
- `bugs.url`

## Default Run Flow

The CLI prefers checked-in starter files from `./defaults/`, and falls back to the project root if you override them locally.

Preferred default path:

- `defaults/repos.csv` or `defaults/repos.txt` or `defaults/repos.json`
- `defaults/base-dir.txt`
- `defaults/weights.json`
- `defaults/repo_weights.json`
- `defaults/affiliations.json`
- `defaults/low_hanging_thresholds.json`
- `defaults/label_rules.json`
- `defaults/code_jam_thresholds.json`

Fallback root-level path:

- `repos.csv` or `repos.txt` or `repos.json`
- `base-dir.txt`
- `weights.json`
- `repo_weights.json`
- `affiliations.json`
- `low_hanging_thresholds.json`
- `label_rules.json`
- `code_jam_thresholds.json`

That means the normal repeat-use flow can be as short as:

```bash
npm run build
npm run scan
```

Direct launcher from the repo:

- macOS / Linux: `./prioritize-prs`
- Windows: `.\prioritize-prs.cmd`

For development without rebuilding:

```bash
npm run scan:dev
```

The `defaults/` directory is intentionally checked in and safe to ship. Its contents are fictional starter data so the app has a stable default location out of the box.

The shipped code-jam defaults are intentionally opinionated:

- `Pick Next` aims to stay small but non-empty in a healthy queue.
- High-confidence merge-ready quick wins can be promoted into `Pick Next` even when business metadata is sparse.
- Routine automation or maintenance churn is still kept out of that top bucket.

If you want to use your own real repo and config data without editing the checked-in defaults, put your own files in the project root. The root-level input files are gitignored so you can keep local run data out of Git.

## Usage

```bash
npm run start -- --repos-file ./examples/repos.txt --output-dir ./out --format all
```

Or after build:

```bash
npx prioritize-prs --repo owner-example/repo-one --repo owner-example/repo-two --format md
```

Discover repos from CODEOWNERS ownership in an org:

```bash
prioritize-prs --org exampleorg --codeowners-team platform-core --ownership-mode either --format md
```

Large-org discovery with safer scaling defaults:

```bash
prioritize-prs --org exampleorg --codeowners-team platform-core --codeowners-mode auto --only-with-open-prs --repo-limit 500 --format md
```

CSV input resolved from a base-dir file:

```bash
npx prioritize-prs --base-dir-file ./examples/base-dir.txt --repos-csv repos.csv --repo-column repo --format md
```

### list-repos subcommand

List repos owned by a CODEOWNERS team without running a full PR scan:

```bash
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core
```

This is useful for verifying team ownership coverage, building input lists for other tools, or quickly auditing which repos a team owns.

Options:

- `--org <org>` (required)
- `--codeowners-team <team>` (required)
- `--codeowners-mode <auto|search|deep>` (default: `auto`)
- `--include-archived`
- `--only-with-open-prs`
- `--repo-limit <number>`
- `--format <text|json|csv>` (default: `text`)
- `--output <file>` — write to file instead of stdout
- `--verbose`

Output formats:

- `text` — one `owner/repo` per line, suitable for piping
- `json` — array of `{ owner, repo, fullName }` objects
- `csv` — header row plus `owner,repo,fullName` rows

Examples:

```bash
# Plain list
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core

# JSON
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --format json

# Save to file
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --output repos.txt

# Only repos that currently have open PRs
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --only-with-open-prs
```

The repo count is printed to stderr so it does not pollute piped output.

## Convenience Commands

Cross-platform via npm:

- `npm run build`
- `npm run scan`
- `npm run scan:dev`
- `npm run clean`
- `npm run clean:reports`
- `npm run test:build`
- `npm test`

For macOS/Linux users who prefer `make`:

- `make build`
- `make test`
- `make scan`
- `make clean`

## Install As A CLI

If you want `prioritize-prs` available as a normal shell command instead of calling `node` yourself:

```bash
npm install
npm run build
npm link
```

After that, you can run:

```bash
prioritize-prs
```

without prefixing it with `node`, `npx`, or another launcher.

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

### list-repos subcommand

```bash
node dist/index.js list-repos [options]
```

- `--org <org>` (required)
- `--codeowners-team <team>` (required)
- `--codeowners-mode <auto|search|deep>`
- `--include-archived`
- `--only-with-open-prs`
- `--repo-limit <number>`
- `--format text|json|csv`
- `--output <file>`
- `--verbose`

## Auth Behavior

The tool validates credentials before scanning:

1. Checks whether `gh` is available.
2. If available, runs a lightweight `gh auth status` check.
3. If authenticated, uses the GitHub CLI auth token for API requests.
4. Otherwise, tries `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_PAT`.
5. Exits non-zero with next steps if no valid auth path is available.

The chosen mode is printed at runtime, for example:

- `Using GitHub CLI authentication`
- `Using token-based API authentication`

## CODEOWNERS Discovery

If you supply both `--org` and `--codeowners-team`, the CLI switches into repo-discovery mode.

Discovery:

- It lists repos in the GitHub organization or uses GitHub code search, depending on `--codeowners-mode`.
- It checks common CODEOWNERS paths:
  - `.github/CODEOWNERS`
  - `CODEOWNERS`
  - `docs/CODEOWNERS`
- It keeps only repos whose CODEOWNERS file mentions the requested team.

Ownership narrowing:

- `assigned`
  - Keep PRs where the team is directly requested or a requested reviewer is a member of that team.
- `touched`
  - Keep PRs whose changed files match CODEOWNERS paths owned by that team.
- `either`
  - Keep PRs that match either assigned review ownership or touched owned paths.
  - This is the default because it is the most useful broad triage mode.
- `both`
  - Keep only PRs that match both active assignment and touched owned paths.

Team matching accepts either a plain slug like `platform-core` or a full reference like `@exampleorg/platform-core`.

Discovery modes:

- `auto`
  - Uses `deep` scanning for small orgs or very small `--repo-limit` runs.
  - Uses GitHub code search for larger orgs.
- `search`
  - Uses GitHub code search against `filename:CODEOWNERS`.
  - This is the preferred option for large orgs.
- `deep`
  - Lists repos and probes common CODEOWNERS file paths repo by repo.
  - This is exact but much more expensive.

### API Demand Notes

This mode is more API-intensive than supplying a fixed repo list.

Approximate request shape in `search` mode:

- A handful of search requests, up to 10 pages of 100 results
- Optional open-PR filtering on matched repos only
- Normal PR scan only for matched repos

Approximate request shape in `deep` mode:

- Org repo listing: about 1 request per 100 repos
- CODEOWNERS checks: up to 3 content requests per repo
- Normal PR scan only for matched repos

At org sizes in the thousands, `deep` mode can become too expensive for routine use. For example, a 3,000-repo org can imply roughly 9,000 CODEOWNERS content lookups before PR scanning starts.

For large orgs, the recommended pattern is:

```bash
prioritize-prs --org exampleorg --codeowners-team platform-core --codeowners-mode search --only-with-open-prs
```

Use `--repo-limit` for smoke tests and early tuning runs.

## Reports

Generated reports include:

- Ranked PR list with score breakdown
- Recommendation buckets:
  - Pick Next
  - Quick Wins
  - Important but Heavy
  - Needs Clarification
  - Probably Deprioritize for Code Jam
- Repo summaries
- Confidence and caveat section

## Configuration Files

See the `examples/` directory for starter config files:

- `weights.json`
- `repo_weights.json`
- `affiliations.json`
- `low_hanging_thresholds.json`
- `label_rules.json`
- `code_jam_thresholds.json`
- `repos.txt`
- `repos.csv`
- `base-dir.txt`

All example inputs are fictional and intended as templates only.

`affiliations.json` supports both formats.

Legacy flat map:

```json
{
  "maintainer_user_1": "internal-maintainer",
  "external_contributor_1": "external"
}
```

Category-grouped map:

```json
{
  "top_community_contributors": ["foo", "bar", "baz"],
  "vip_orgs": "vip_org_1, vip_org_2, vip_org_3",
  "internal_staff": ["maintainer_user_1", "release_manager_1"]
}
```

If the same user appears in multiple categories, the tool keeps all of them and joins them into a single affiliation string.

The `defaults/` directory contains the real built-in fallback files that the CLI will use automatically when no explicit paths are provided.

The repo also ships a checked-in [`.github/CODEOWNERS`](./.github/CODEOWNERS) file so the project can dogfood CODEOWNERS-based ownership and discovery behavior.

## Testing

See [TESTING.md](./TESTING.md) for:

- automated test commands
- CLI smoke-test commands
- CODEOWNERS discovery smoke-test guidance
- expected manual validation checks

## Example Full Run

```bash
node dist/index.js --base-dir-file ./examples/base-dir.txt --repos-csv repos.csv --repo-column repo --repo-business-weight ./examples/repo_weights.json --org-affiliation-map ./examples/affiliations.json --weights-file ./examples/weights.json --low-hanging-thresholds ./examples/low_hanging_thresholds.json --label-rules-file ./examples/label_rules.json --code-jam-thresholds-file ./examples/code_jam_thresholds.json --output-dir ./out --format all
```

## Notes On Scoring

Default weighted formula:

- Business / Strategic Relevance: `0.34`
- Unblock Value: `0.22`
- Merge Readiness: `0.18`
- Effort / Review Cost: `0.12`
- Staleness Signal: `0.09`
- Community / Relationship Value: `0.05`

The implementation is heuristic by design. Signals such as stakeholder urgency, business importance, and dependency impact are inferred from metadata and text patterns, so humans should treat the output as a queue-shortening aid, not an automatic decision.

## Default Philosophy

The shipped defaults are intentionally tuned to be useful for a first run without much editing:

- They bias toward business relevance and unblock value over raw "small diff" convenience.
- They are conservative about what counts as low-hanging fruit, so the report does not flood with false-positive quick wins.
- They penalize maintenance churn and automation work enough that bot-style PRs should not dominate the top of the queue.
- They still allow small compatibility and platform-support fixes to surface when they are merge-ready and plausibly valuable.

If a new user copies the example JSON files into the project root and runs the tool without much customization, the result should be a credible starting queue rather than a generic "smallest PRs first" list.

## Sample Output

Example artifacts are included here:

- [sample markdown](./examples/sample-output/pr-priorities.md)
- [sample json](./examples/sample-output/pr-priorities.json)
- [sample csv](./examples/sample-output/pr-priorities.csv)
