---
name: validate
description: Run full project validation — build, test build, and test suite
---

Run full project validation and report results:

```bash
npm run build && npm run test:build && npm test
```

If any step fails, show the relevant error output and stop. Do not proceed to the next step if a prior one fails.
