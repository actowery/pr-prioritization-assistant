# Quickstart

This guide is for the person who wants a useful report fast without reading the whole repo first.

## What This Tool Does

You point it at either:

- a list of repos
- or a GitHub org plus a CODEOWNERS team

and it gives you:

- a ranked PR list
- a Markdown report
- JSON and CSV output if you want them
- enough explanation to sanity-check the ranking

It is a recommendation assistant, not an auto-decider.

It also ships a `list-repos` subcommand if you just want to see which repos a CODEOWNERS team owns, without running a full PR scan.

## Before You Start

You need:

- Node.js 22+
- Git installed
- GitHub access through one of:
  - `gh auth login`
  - `GITHUB_TOKEN`
  - `GH_TOKEN`
  - `GITHUB_PAT`

## First-Time Setup

From the repo root:

```bash
npm install
npm run build
```

If you want the command available globally on your machine:

```bash
npm link
```

Then you can use:

```bash
prioritize-prs
```

If you do not want to link it globally:

Windows:

```powershell
.\prioritize-prs.cmd
```

macOS / Linux:

```bash
./prioritize-prs
```

## Easiest Ways To Use It

### Option 1: Use the built-in defaults

```bash
prioritize-prs
```

The tool looks in `defaults/` automatically. Those files are templates. Replace them with your own values or put your own files in the repo root.

### Option 2: Give it a repo list

```bash
prioritize-prs --repos-csv ./defaults/repos.csv --repo-column repo --format all --output-dir ./out
```

Or:

```bash
prioritize-prs --repo owner-example/repo-one --repo owner-example/repo-two --format md --output-dir ./out
```

### Option 3: Discover repos from CODEOWNERS

This is the best option when you want "show me PRs that belong to my team."

```bash
prioritize-prs --org exampleorg --codeowners-team @exampleorg/platform-core --codeowners-mode search --ownership-mode either --only-with-open-prs --format all --output-dir ./out-platform-core
```

What that means:

- `--org exampleorg`
  - search inside the `exampleorg` org
- `--codeowners-team @exampleorg/platform-core`
  - target that CODEOWNERS team
- `--codeowners-mode search`
  - use the scalable discovery mode
- `--ownership-mode either`
  - include PRs that are actively assigned to the team or touch files owned by the team
- `--only-with-open-prs`
  - skip discovered repos that have no open PRs

## Recommended Commands

### Small smoke test

```bash
prioritize-prs --repo owner-example/priority-sdk --max-prs-per-repo 3 --format md --output-dir ./out-smoke
```

### Real repo-list run

```bash
prioritize-prs --repos-csv ./repos.csv --repo-column repo --format all --output-dir ./out
```

### Real CODEOWNERS run

```bash
prioritize-prs --org exampleorg --codeowners-team @exampleorg/platform-core --codeowners-mode search --ownership-mode either --only-with-open-prs --format all --output-dir ./out-platform-core
```

### Safer large-org test run

```bash
prioritize-prs --org exampleorg --codeowners-team @exampleorg/platform-core --codeowners-mode search --ownership-mode either --only-with-open-prs --repo-limit 50 --max-prs-per-repo 3 --format md --output-dir ./out-platform-core-smoke
```

## Understanding The Output

The main files are:

- `pr-priorities.md`
- `pr-priorities.json`
- `pr-priorities.csv`

The Markdown report is the easiest place to start.

Look first at:

- `Summary`
- `Top Recommendations`
- `Recommendation Buckets`
- `Partial Failures`

If a run was cut short by rate limiting or permissions, the report should tell you.

## Ownership Modes

If you are using CODEOWNERS discovery, this setting matters:

- `assigned`
  - only PRs actively assigned to the team or a team member
- `touched`
  - only PRs that touch files owned by the team in CODEOWNERS
- `either`
  - union of both
  - best default for most people
- `both`
  - strictest option

If you are not sure, use:

```bash
--ownership-mode either
```

## Discovery Modes

If you are scanning an org through CODEOWNERS:

- `search`
  - best for larger orgs
- `deep`
  - slower and more API-heavy, but exact per repo
- `auto`
  - lets the tool choose

If the org is big, use:

```bash
--codeowners-mode search
```

## Common Problems

### "No valid GitHub authentication path was found"

Run:

```bash
gh auth login
```

or set a token in one of:

- `GITHUB_TOKEN`
- `GH_TOKEN`
- `GITHUB_PAT`

### "API rate limit reached"

That means GitHub throttled the scan.

Try one or more of these:

- wait for the reset time
- reduce `--repo-limit`
- reduce `--max-prs-per-repo`
- use `--codeowners-mode search` for org scans
- run a smaller smoke test first

### "Why are there so few PRs?"

If you used CODEOWNERS mode, the tool may be filtering to:

- PRs actively assigned to that team
- PRs touching that team's owned paths
- or both, depending on `--ownership-mode`

If the result feels too strict, use:

```bash
--ownership-mode either
```

## Good Handoff Command

If you are handing this to someone non-technical or semi-technical, this is a good starting command:

```bash
prioritize-prs --org exampleorg --codeowners-team @exampleorg/platform-core --codeowners-mode search --ownership-mode either --only-with-open-prs --repo-limit 100 --format md --output-dir ./out
```

It is:

- reasonably scalable
- easy to inspect
- unlikely to overwhelm them with raw JSON first

## Just Want To See Which Repos A Team Owns?

Use the `list-repos` subcommand — no PR scan, no reports, just the repo list:

```bash
node dist/index.js list-repos --org exampleorg --codeowners-team @exampleorg/platform-core
```

This is useful for verifying ownership before running a full scan, or for piping into other tools.

## Useful Follow-Up Files

- [README.md](./README.md)
- [TESTING.md](./TESTING.md)

If the goal is just to get a result quickly, start with this:

```bash
prioritize-prs --org exampleorg --codeowners-team @exampleorg/platform-core --codeowners-mode search --ownership-mode either --only-with-open-prs --format md --output-dir ./out
```
