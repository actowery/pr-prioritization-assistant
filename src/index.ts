#!/usr/bin/env node
import { parseCliOptions, runCli } from "./cli.js";

Promise.resolve()
  .then(() => parseCliOptions(process.argv.slice(2)))
  .then((options) => runCli(options))
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] ${message}`);
    process.exitCode = 1;
  });
