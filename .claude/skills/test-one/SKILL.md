---
name: test-one
description: Build tests and run a single test file by name (e.g. scoring, config, codeowners)
---

Build the test suite, then run the specific test file matching `$ARGUMENTS`:

```bash
npm run test:build && node --test dist-tests/tests/$ARGUMENTS.test.js
```

Available test files: `cli`, `cli-helpers`, `config`, `codeowners`, `reporting`, `scoring`

If no argument is given, ask which test file to run.
