# PR Prioritization Assistant

A cross-platform CLI that scans GitHub repositories, analyzes open PRs, and produces explainable recommendation reports. **Advisory only** — it never merges PRs, posts comments, or modifies any repository state.

## Architecture

```
src/index.ts          # Thin entry point → calls parseCliOptions() + runCli()
src/cli.ts            # Commander.js CLI, main orchestration
src/auth.ts           # Auth: gh CLI → GITHUB_TOKEN → GH_TOKEN → GITHUB_PAT
src/config.ts         # JSON config loading and merging
src/constants.ts      # Default scoring weights and thresholds
src/types.ts          # All TypeScript type definitions
src/scoring.ts        # Multi-dimensional PR scoring heuristics
src/github/client.ts  # GitHub API client
src/github/codeowners.ts  # CODEOWNERS parsing and team matching
src/reporting/reporters.ts  # Markdown, JSON, CSV report generation
src/utils.ts          # Path resolution, file I/O, command execution
src/logging.ts        # Structured logger with verbose mode
```

Tests mirror source: `tests/scoring.test.ts` covers `src/scoring.ts`, etc.

## Build & Test Commands

```bash
npm run build              # Compile TypeScript → dist/
npm run typecheck          # Type check only (no emit)
npm run test:build         # Compile tests → dist-tests/
npm test                   # Run test suite
npm run scan:dev -- [args] # Run CLI without building (tsx)
npm run scan -- [args]     # Run compiled CLI
node scripts/clean.mjs     # Remove dist/, dist-tests/, out/
npm pack --dry-run         # Verify package contents before publish
```

Full validation before shipping any change:
```bash
npm run build && npm run test:build && npm test
```

## Code Style

- ES modules throughout (`import`/`export`), never CommonJS
- TypeScript strict mode — `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are both enabled
- Local imports require `.js` extension (NodeNext module resolution): `import { foo } from './bar.js'`
- 2-space indentation, LF line endings (enforced by `.editorconfig`)
- Destructured imports preferred: `import { foo, bar } from './module.js'`

## Testing

- Framework: Node.js built-in `node:test` with `node:assert/strict`
- Tests require a build step before running — always `build && test:build && test`
- No GitHub API mocking — tests use fixtures and pure logic only
- Fixtures and test data live in `tests/`

## Scoring Model (`src/scoring.ts`)

Six weighted dimensions sum to 1.0:

| Dimension | Weight | What it measures |
|---|---|---|
| `businessRelevance` | 0.34 | Labels, author affiliation, age |
| `unblockValue` | 0.22 | Blocker/dependency labels |
| `mergeReadiness` | 0.18 | Reviews, CI status, conflicts |
| `effortReviewCost` | 0.12 | Diff size, file count |
| `stalenessSignal` | 0.09 | Idle days, last activity |
| `communityValue` | 0.05 | External contributor signals |

Output buckets: `Pick Next` → `Quick Wins` → `Important but Heavy` → `Needs Clarification` → `Probably Deprioritize for Code Jam`

## Key Guardrails

- **Never add code that posts to GitHub, merges PRs, or modifies external state.** The tool is read-only.
- `defaults/` and `examples/` are public starter templates — keep all content fictional and generic, no org/user-specific details.
- Root-level data files (`repos.csv`, `affiliations.json`, etc.) are gitignored local test data — never commit them.
- Node.js >= 22 required.

## Configuration

All config is via CLI flags pointing to JSON files. Schemas live in `defaults/`, sample values in `examples/`. Never hard-code org names, usernames, or internal URLs anywhere in the codebase.

## Documentation

When behavior changes, update the relevant doc if it affects CLI flags, default behavior, report output, testing flow, or packaging:

- `README.md` — full reference
- `QUICKSTART.md` — getting started guide
- `TESTING.md` — test and validation steps

## Git Workflow

- Main branch: `main` — public at `https://github.com/actowery/pr-prioritization-assistant`
- Run full validation before committing
- CI matrix: Ubuntu × macOS × Windows, Node 22
- Be careful not to commit local test data in starter files under `defaults/` or `examples/`
