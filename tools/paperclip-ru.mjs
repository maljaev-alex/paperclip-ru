#!/usr/bin/env node
import { main } from "./lib/cli.mjs";

const code = await main(process.argv.slice(2));
process.exit(code);
