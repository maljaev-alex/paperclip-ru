/**
 * Deterministic failpoints for transaction tests.
 * Set PAPERCLIP_RU_FAILPOINT to a step name, or permission:<step>.
 */

export function failpointName() {
  return process.env.PAPERCLIP_RU_FAILPOINT || "";
}

const COUNTS = new Map();

export function hit(step, opts = {}) {
  const want = failpointName();
  if (!want) return;
  for (const spec of want.split(",")) hitOne(spec.trim(), step, opts);
}

function hitOne(want, step, opts) {
  let spec = want;
  const crash = spec.startsWith("crash:");
  if (crash) spec = spec.slice("crash:".length);
  let permission = false;
  let after = false;
  if (spec.startsWith("permission:")) {
    permission = true;
    spec = spec.slice("permission:".length);
  }
  if (spec.startsWith("after:")) {
    after = true;
    spec = spec.slice("after:".length);
  }
  let nth = 1;
  const nthMatch = spec.match(/^(.*)#(\d+)$/);
  if (nthMatch) {
    spec = nthMatch[1];
    nth = Number(nthMatch[2]);
  }
  if (spec !== step && spec !== "*") return;
  if (after !== Boolean(opts.after)) return;
  const key = `${want}:${after ? "after:" : ""}${step}`;
  const n = (COUNTS.get(key) || 0) + 1;
  COUNTS.set(key, n);
  if (n !== nth) return;
  if (crash) process.exit(86);
  const err = new Error(`failpoint:${after ? "after:" : ""}${step}`);
  err.failpoint = step;
  err.after = after;
  if (permission) err.code = "EACCES";
  throw err;
}
