---
name: clean-build
description: Remove all build artifacts and rebuild from scratch
---

```bash
node scripts/clean.mjs && npm run build
```

Use this when the build feels stale or after dependency changes.
