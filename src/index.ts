#!/usr/bin/env node
import { parseCliOptions, parseListReposOptions, runCli, runListRepos } from "./cli.js";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  if (args[0] === "list-repos") {
    const options = parseListReposOptions(args.slice(1));
    await runListRepos(options);
  } else {
    const options = parseCliOptions(args);
    await runCli(options);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exitCode = 1;
});
