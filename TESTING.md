# Testing

This project supports both automated checks and practical end-to-end smoke runs.

## Automated Checks

Recommended local verification:

```bash
npm run build
npm run test:build
npm test
```

Or with `make` on macOS/Linux:

```bash
make build
make test
```

What these cover:

- TypeScript compilation for the CLI
- Test compilation for the test suite
- CLI option parsing and default-path resolution
- Executable CLI validation behavior for common error cases
- Config normalization, including affiliation config shapes
- Scoring heuristics
- CODEOWNERS parsing and matching helpers

## CLI Smoke Tests

From the repo root on Windows:

```powershell
.\prioritize-prs.cmd --help
.\prioritize-prs.cmd --repo owner-example/priority-sdk --max-prs-per-repo 1 --format md --output-dir .\out-smoke
```

From the repo root on macOS/Linux:

```bash
./prioritize-prs --help
./prioritize-prs --repo owner-example/priority-sdk --max-prs-per-repo 1 --format md --output-dir ./out-smoke
```

If you installed the package as a normal command:

```bash
prioritize-prs --help
```

## prioritize-issues Smoke Test

Verify the subcommand routes correctly and emits issue report files:

```bash
node dist/index.js prioritize-issues --repo owner-example/repo-one --max-issues-per-repo 5 --format md --output-dir ./out
```

CODEOWNERS discovery:

```bash
node dist/index.js prioritize-issues --org exampleorg --codeowners-team platform-core --only-with-open-prs --repo-limit 5 --format all --output-dir ./out
```

What to verify:

- `out/issue-priorities.md` exists and has 5 bucket sections.
- `out/issue-priorities.json` and `out/issue-priorities.csv` exist when using `--format all`.
- `out/pr-priorities.md` is unchanged if you also run the default PR command.
- Running `node dist/index.js --repo owner-example/repo-one` still produces PR output (no regression).
- `node dist/index.js prioritize-issues --help` prints the issue-specific flag list.

## list-repos Smoke Test

Verify the subcommand routes correctly and returns a repo list:

```bash
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core
```

JSON output:

```bash
node dist/index.js list-repos --org exampleorg --codeowners-team platform-core --format json
```

What to verify:

- One `owner/repo` per line in text mode, or a valid JSON array in json mode.
- The repo count is printed to stderr, not stdout.
- The existing default command still works (`node dist/index.js --repo owner/repo`).

## CODEOWNERS Discovery Smoke Test

Example command:

```bash
prioritize-prs --org exampleorg --codeowners-team platform-core --ownership-mode either --repo-limit 25 --format md
```

Scalable large-org smoke test:

```bash
prioritize-prs --org exampleorg --codeowners-team platform-core --codeowners-mode search --only-with-open-prs --repo-limit 100 --format md
```

What to verify:

- The CLI prints a CODEOWNERS discovery message before scanning PRs.
- The CLI prints which CODEOWNERS discovery mode it selected.
- The report shows plausible ownership matches such as direct team request, team-member request, or CODEOWNERS path match.
- Only repos with matching CODEOWNERS entries are scanned.
- The resulting report looks like a normal prioritization run after repo discovery.

## Expected Manual Checks

After a real run, inspect the generated report and confirm:

- `Pick Next` is small and plausible, not empty by default unless the queue is truly weak.
- Bot and maintenance churn are not dominating the top recommendations.
- Compatibility and merge-ready small fixes can surface as `Quick Wins` or `Pick Next`.
- Partial failures are reported without aborting the entire run.

## Notes

- Live GitHub smoke tests depend on your local `gh` auth or token setup.
- API-heavy scans can still be limited by GitHub throttling, especially across many repos.
- The checked-in `defaults/` and `examples/` inputs are fictional starter data.
