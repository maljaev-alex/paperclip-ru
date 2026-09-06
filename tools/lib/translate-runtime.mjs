/**
 * Node-side translator used by unit tests. Keep behaviour aligned with
 * tools/lib/overlay.mjs runtime (lookup, recase, plural, {t}/{tl}/{r}/$N).
 */
export function plural(n, one, few, many) {
  const v = Math.abs(parseInt(n, 10)) % 100;
  const d = v % 10;
  if (v > 10 && v < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

export function recase(source, value) {
  if (!value) return value;
  const first = source.charAt(0);
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return value;
  if (source.length > 1 && source === source.toUpperCase()) return value.toUpperCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function createTranslator({ exact, rules = [], plurals = {} }) {
  const DICT = exact instanceof Map ? Object.fromEntries(exact) : { ...exact };
  const RULES = rules.map((r) => ({
    re: new RegExp(r.pattern, r.flags || ""),
    to: r.replace,
    scope: r.scope || "any",
  }));
  const lower = Object.create(null);
  for (const k of Object.keys(DICT)) {
    lower[k.toLowerCase()] = DICT[k];
    const kt = k.trim();
    if (kt && kt !== k && lower[kt.toLowerCase()] === undefined) {
      const kv = DICT[k];
      lower[kt.toLowerCase()] = typeof kv === "string" ? kv.replace(/^\s+/, "") : kv;
    }
  }

  function lookup(text) {
    if (text == null) return null;
    const raw = String(text);
    if (DICT[raw] !== undefined) return DICT[raw];
    const t = raw.trim();
    if (!t) return null;
    if (DICT[t] !== undefined) return DICT[t];
    if (DICT[` ${t}`] !== undefined) return DICT[` ${t}`];
    const lc = lower[t.toLowerCase()];
    return lc !== undefined ? lc : null;
  }

  function format(tpl, m) {
    return tpl
      .replace(/\{plural:(\d+):([^}]*)\}/g, (_, gi, forms) => {
        const f = forms.split("|");
        return plural(m[+gi], f[0], f[1] !== undefined ? f[1] : f[0], f[2] !== undefined ? f[2] : f[0]);
      })
      .replace(/\{(t|tl|r):(\d)\}/g, (whole, mode, gi) => {
        const raw = m[+gi];
        if (raw == null) return whole;
        const mapped = mode === "r" ? core(raw, "text") : lookup(raw);
        let out = mapped !== null ? mapped : raw;
        if (mode === "tl" && mapped !== null) out = out.charAt(0).toLowerCase() + out.slice(1);
        return out;
      })
      .replace(/\$(\d)/g, (whole, gi) => (m[+gi] != null ? m[+gi] : whole));
  }

  let depth = 0;
  function core(text, scope) {
    if (text === "s") return "";
    if (DICT[text] !== undefined) return DICT[text];
    if (DICT[` ${text}`] !== undefined) return String(DICT[` ${text}`]).replace(/^\s+/, "");
    const collapsed = text.replace(/\s+/g, " ");
    if (DICT[collapsed] !== undefined) return DICT[collapsed];
    if (DICT[` ${collapsed}`] !== undefined) return String(DICT[` ${collapsed}`]).replace(/^\s+/, "");
    const lc = lower[collapsed.toLowerCase()];
    if (lc !== undefined) return recase(collapsed, lc);

    if (/^[a-z][a-z0-9]*([._][a-z0-9]+)+$/.test(collapsed)) {
      const human = lower[collapsed.replace(/[._]/g, " ")];
      if (human !== undefined) return recase(collapsed, human);
    }

    if (collapsed.includes(" \u2022 ")) {
      let touched = false;
      const joined = collapsed.split(" \u2022 ").map((p) => {
        const r = lookup(p);
        if (r !== null) {
          touched = true;
          return r;
        }
        return p;
      });
      if (touched) return joined.join(" \u2022 ");
    }

    if (depth < 4) {
      depth += 1;
      try {
        for (const rule of RULES) {
          if (rule.scope !== "any" && rule.scope !== scope) continue;
          rule.re.lastIndex = 0;
          const m = rule.re.exec(collapsed);
          if (m) return format(rule.to, m);
        }
      } finally {
        depth -= 1;
      }
    }
    return null;
  }

  function translate(value, scope = "text") {
    if (typeof value !== "string" || value.length === 0 || value.length > 600) return value;
    const LATIN = /[A-Za-z]/;
    const CYRILLIC = /[\u0400-\u04FF]/;
    const DIGITS = /^[\d./: -]+$/;
    if (!(LATIN.test(value) || (value.length <= 12 && DIGITS.test(value) && !CYRILLIC.test(value)))) return value;
    const lead = value.match(/^\s*/)[0];
    const tail = value.match(/\s*$/)[0];
    const body = value.slice(lead.length, value.length - tail.length);
    if (!body) return value;
    const mapped = core(body, scope);
    if (mapped !== null && mapped !== body) return lead + mapped + tail;
    return value;
  }

  return { translate, lookup, core, format, plural, recase, plurals };
}
