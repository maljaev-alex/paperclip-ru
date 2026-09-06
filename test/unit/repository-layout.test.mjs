import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { PROJECT_ROOT } from "../../tools/lib/dictionary.mjs";

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"));
}

test("every versioned non-service directory has a README", () => {
  const files = trackedFiles();
  const tracked = new Set(files);
  const directories = new Set();

  for (const file of files) {
    const parts = file.split("/").slice(0, -1);
    if (parts.some((part) => part.startsWith("."))) continue;
    for (let depth = 1; depth <= parts.length; depth += 1) {
      directories.add(parts.slice(0, depth).join("/"));
    }
  }

  const missing = [...directories]
    .filter((directory) => !tracked.has(`${directory}/README.md`))
    .sort();
  assert.deepEqual(missing, []);
  assert.ok(tracked.has("README.md"), "repository root README");
});

test("tracked tree excludes reports, intermediate translation parts and generated output", () => {
  const files = trackedFiles();
  const forbidden = files.filter((file) =>
    /^(work|dist|node_modules|test-results|coverage)\//.test(file)
    || /^locales\/parts\//.test(file)
    || /^docs\/audits\//.test(file)
    || /^(?:docs\/)?(?:COMPREHENSIVE-REVIEW|INDEPENDENT-REVIEW|PANEL-RESIZE-FIX|PUBLIC-RELEASE-SPEC|RELEASE-CANDIDATE-REPORT|RELEASE-REMEDIATION)/i.test(file)
    || /^docs\/(?:AGENT-HANDOFF|CHAT-EXPORT|HANDOFF-AFTER-R7)\.md$/i.test(file)
    || /(?:^|\/)(?:\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(file)
    || /\.(?:tmp|temp|bak|old|orig|rej|log|zip|tgz|tar\.gz)$/i.test(file)
  );
  assert.deepEqual(forbidden, []);
  assert.deepEqual(files.filter((file) => /(^|\/)AGENTS?\.md$/i.test(file)), ["AGENTS.md"]);
});
