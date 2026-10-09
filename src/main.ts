#!/usr/bin/env node
import { main } from "./cli.ts";

main(process.argv.slice(2)).catch((e: Error) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exit(1);
});
