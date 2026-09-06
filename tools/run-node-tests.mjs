#!/usr/bin/env node
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const patterns = process.argv.length > 2 ? process.argv.slice(2) : ["test/**/*.test.mjs"];
// fs.globSync is not available in the supported Node 20 runtime.
function expand(dir, parts) {
  if (!parts.length) return fs.existsSync(dir) && fs.statSync(dir).isFile() ? [dir] : [];
  const [part, ...rest] = parts;
  if (part === "**") return [
    ...expand(dir, rest),
    ...fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).flatMap((e) => expand(path.join(dir, e.name), parts)),
  ];
  if (!part.includes("*")) return expand(path.join(dir, part), rest);
  const regex = new RegExp(`^${part.split("*").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return fs.readdirSync(dir).filter((name) => regex.test(name)).flatMap((name) => expand(path.join(dir, name), rest));
}
// POSIX shells can expand the glob before invoking Node; keep every argument.
const files = [...new Set(patterns.flatMap((pattern) => expand(".", pattern.replace(/\\/g, "/").split("/"))))].sort();
if (!files.length) {
  console.error(`Нет тестов по шаблону ${patterns.join(", ")}`);
  process.exit(1);
}
// Official browser scenarios share one disposable seed and temporarily edit it.
const official = files.some((file) => file.replace(/\\/g, "/").startsWith("test/official/"));
const child = spawn(process.execPath, ["--test", "--test-reporter=spec", ...(official ? ["--test-concurrency=1"] : []), ...files.map((f) => path.resolve(f))], {
  stdio: "inherit",
});
child.on("close", (code) => process.exit(code ?? 1));
child.on("error", (error) => { console.error(error.message); process.exit(1); });
