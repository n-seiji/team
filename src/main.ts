#!/usr/bin/env node
import { main } from "./cli.ts";

// `team log | head` closes the pipe early; that is not an error.
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

main(process.argv.slice(2)).catch((e: Error) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
});
