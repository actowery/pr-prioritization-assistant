---
name: release-check
description: Full pre-release validation — build, tests, and package contents check
---

Run the complete pre-release checklist:

```bash
npm run build && npm run test:build && npm test && npm pack --dry-run
```

Confirm all steps pass and review the `npm pack` file list for anything that shouldn't be published. Check that no local test data files (repos.csv, affiliations.json, etc.) are included.
