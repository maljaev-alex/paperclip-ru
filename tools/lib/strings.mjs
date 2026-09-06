import * as acorn from "acorn";

/**
 * Property names whose values carry machine meaning (ids, routes, css, enum
 * values). Replacing them would change behaviour, never appearance.
 */
const SEMANTIC_KEYS = new Set([
  "accept", "action", "adapter", "algorithm", "align", "anchor", "as", "autoComplete",
  "capability", "charset", "class", "className", "code", "color", "column", "command",
  "contentType", "data-slot", "data-state", "data-testid", "dataSlot", "dir", "direction",
  "displayMode", "encoding", "endpoint", "entity", "env", "event", "eventName", "ext",
  "extension", "field", "font", "fontFamily", "format", "groupKey", "hotkey", "href", "id",
  "icon", "iconName", "key", "kind", "lang", "layout", "level", "locale", "method",
  "mimeType", "mode", "model", "namespace", "ns", "op", "operator", "orientation", "pathname",
  "path", "permission", "placement", "position", "preset", "provider", "rel", "resource",
  "role", "route", "scope", "shortcut", "side", "size", "slug", "sortKey", "src", "state",
  "status", "step", "tag", "tagName", "target", "template", "testId", "theme", "to", "type",
  "url", "value", "variant", "verb", "version", "weight", "width", "height",
  "systemPrompt", "instructions", "storageKey", "localStorageKey",
]);

/** DOM/storage APIs whose first argument is a selector or key, not visible text. */
const SELECTOR_CALLS = new Set([
  "querySelector", "querySelectorAll", "getElementById", "getElementsByClassName",
  "getElementsByTagName", "createElement", "createElementNS", "closest", "matches",
  "getAttribute", "hasAttribute", "removeAttribute", "setAttribute", "addEventListener",
  "removeEventListener", "dispatchEvent", "getItem", "setItem", "removeItem", "matchMedia",
  "getPropertyValue", "setProperty", "removeProperty", "add", "remove", "toggle", "contains",
  "requireActual", "require", "importScripts",
]);

const EQUALITY_OPS = new Set(["==", "===", "!=", "!==", "<", ">", "<=", ">=", "in", "instanceof"]);

const SKIP_PARENT_TYPES = new Set([
  "ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression",
  "Directive",
]);

function isNode(v) {
  return v && typeof v === "object" && typeof v.type === "string";
}

/** Depth-first ESTree walk that yields every node together with its parent chain. */
function walk(root, visit) {
  const stack = [{ node: root, parents: [] }];
  while (stack.length) {
    const { node, parents } = stack.pop();
    visit(node, parents);
    const childParents = [node, ...parents];
    for (const key of Object.keys(node)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i -= 1) {
          if (isNode(value[i])) stack.push({ node: value[i], parents: childParents });
        }
      } else if (isNode(value)) {
        stack.push({ node: value, parents: childParents });
      }
    }
  }
}

function ownerPropertyKey(parents) {
  for (let i = 0; i < parents.length && i < 4; i += 1) {
    const p = parents[i];
    if (p.type === "Property") {
      if (p.key.type === "Identifier") return p.key.name;
      if (p.key.type === "Literal") return String(p.key.value);
      return null;
    }
    if (p.type !== "ArrayExpression" && p.type !== "ConditionalExpression" && p.type !== "LogicalExpression") {
      return null;
    }
  }
  return null;
}

/**
 * Decides whether a string occurrence may be rewritten without changing app
 * behaviour. Returns null when replacement is safe, otherwise the reason.
 */
export function blockReason(node, parents) {
  const parent = parents[0];
  if (!parent) return "root";

  if (SKIP_PARENT_TYPES.has(parent.type)) return "module-specifier";
  for (let i = 0; i < parents.length; i += 1) {
    const owner = parents[i];
    if (["Property", "PropertyDefinition", "MethodDefinition"].includes(owner.type)
      && owner.key === (i ? parents[i - 1] : node)) return "object-key";
  }
  if (parent.type === "MemberExpression" && parent.property === node) return "member-access";
  if (parent.type === "SwitchCase" && parent.test === node) return "switch-case";
  if (parent.type === "BinaryExpression" && EQUALITY_OPS.has(parent.operator)) return "comparison";
  if (parent.type === "ExpressionStatement") return "directive";
  if (parent.type === "TaggedTemplateExpression") return "tagged-template";

  if (parent.type === "CallExpression" || parent.type === "NewExpression") {
    const callee = parent.callee;
    const argIndex = parent.arguments.indexOf(node);
    if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
      if (SELECTOR_CALLS.has(callee.property.name) && argIndex === 0) return "dom-selector";
      if (callee.property.name === "split" || callee.property.name === "join") return "delimiter";
    }
    if (callee?.type === "Identifier" && /^(require|Symbol)$/.test(callee.name)) return "runtime-call";
  }

  const key = ownerPropertyKey(parents);
  if (key && SEMANTIC_KEYS.has(key)) return `semantic-key:${key}`;

  return null;
}

/** Object keys whose value is displayed to the user. */
export const UI_KEYS = new Set([
  "actionLabel", "alt", "aria-description", "aria-label", "ariaLabel", "body", "buttonLabel",
  "cancelLabel", "caption", "children", "confirmLabel", "cta", "description", "detail", "empty",
  "effect", "emptyDescription", "emptyHint", "emptyLabel", "emptyMessage", "emptyTitle", "error", "errorMessage", "footer",
  "heading", "help", "helper", "helperText", "hint", "human_only", "label", "labelText", "message", "note", "not_creator",
  "placeholder", "prompt", "question", "reason", "secondaryLabel", "subheading", "subtitle",
  "summary", "text", "title", "tooltip", "warning",
]);

function structurallyExcluded(s) {
  if (!/[A-Za-z]{2}/.test(s)) return true;
  if (/^(https?:|mailto:|data:|blob:|\/\/|\.\/|\.\.\/)/i.test(s)) return true;
  if (/^[#.]?[a-f0-9]{6,}$/i.test(s)) return true;
  if (/^\/[\w\-/:*.$]*$/.test(s)) return true;
  if (/^[\w.-]+@[\w.-]+$/.test(s)) return true;
  if (/^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(s)) return true;
  if (/^[a-z]+([A-Z][a-z0-9]*)+$/.test(s)) return true;
  if (/^[A-Z0-9_]{2,}$/.test(s)) return true;
  if (/^--?[\w-]+$/.test(s)) return true;
  if (/^\d+(px|rem|em|%|vh|vw|ms|s)$/.test(s)) return true;
  if (/^[MmLlHhVvCcSsQqTtAaZz][\d\s.,eE+-]*$/.test(s)) return true;
  if (/[<>{}\\|]/.test(s)) return true;
  if (/^[^A-Za-z]*$/.test(s)) return true;
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  if (letters / s.length < 0.45) return true;
  if (isTailwindish(s)) return true;
  return false;
}

/** True for strings shaped like a human-readable phrase or sentence. */
export function looksLikeUiText(value) {
  const s = value.trim();
  if (s.length < 3 || s.length > 400) return false;
  if (structurallyExcluded(s)) return false;

  const hasSpace = /\s/.test(s);
  const startsUpper = /^[A-Z]/.test(s);
  const endsSentence = /[.!?…]$/.test(s);
  const hasLowerWord = /[a-z]{2}/.test(s);

  if (hasSpace && hasLowerWord && (startsUpper || endsSentence)) return true;
  if (!hasSpace && /^[A-Z][a-z]{2,}$/.test(s)) return true;
  return false;
}

/** Short labels that only qualify because they sit in a display-only key. */
export function plausibleLabel(value) {
  const s = value.trim();
  if (s.length < 2 || s.length > 80) return false;
  if (structurallyExcluded(s)) return false;
  return /^[A-Za-z][A-Za-z0-9 '’\-.,!?%:;()\/&+]*$/.test(s);
}

function isTailwindish(s) {
  if (!/\s/.test(s)) {
    return /^(?:[a-z-]+:)*-?[a-z][a-z0-9-]*(?:\/[a-z0-9.]+)?(?:\[[^\]]*\])?$/.test(s) &&
      /-/.test(s) &&
      !/[.!?]/.test(s);
  }
  const parts = s.split(/\s+/);
  if (parts.length < 2) return false;
  const classy = parts.filter((p) =>
    /^(?:[a-z-]+:)*-?[a-z][a-z0-9-]*(?:\/[a-z0-9.]+)?(?:\[[^\]]*\])?$/.test(p) &&
    (/-/.test(p) || /^(?:flex|grid|block|hidden|relative|absolute|fixed|sticky|truncate|group|peer|border|rounded|shadow|italic|underline|uppercase|lowercase|capitalize)$/.test(p))
  );
  return classy.length / parts.length >= 0.8;
}

/**
 * Extracts every string literal and template chunk from a JS bundle together
 * with byte ranges and a replaceability verdict.
 */
export function extractOccurrences(code) {
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: "module",
    allowHashBang: true,
    ranges: false,
  });

  const out = [];
  walk(ast, (node, parents) => {
    if (node.type === "Literal" && typeof node.value === "string") {
      out.push({
        kind: "literal",
        value: node.value,
        start: node.start,
        end: node.end,
        quote: code[node.start] === "'" ? "'" : '"',
        propKey: ownerPropertyKey(parents),
        block: blockReason(node, parents),
      });
      return;
    }
    if (node.type === "TemplateLiteral") {
      const parent = parents[0];
      const blocked = parent?.type === "TaggedTemplateExpression" ? "tagged-template" : blockReason(node, parents);
      for (const quasi of node.quasis) {
        if (!quasi.value.cooked) continue;
        out.push({
          kind: "quasi",
          value: quasi.value.cooked,
          start: quasi.start,
          end: quasi.end,
          quote: "`",
          propKey: ownerPropertyKey(parents),
          block: blocked,
        });
      }
    }
  });

  out.sort((a, b) => a.start - b.start);
  return out;
}

function encodeForQuote(value, quote) {
  if (quote === "`") {
    return value
      .replace(/\\/g, "\\\\")
      .replace(/`/g, "\\`")
      .replace(/\$\{/g, "\\${");
  }
  const json = JSON.stringify(value);
  const inner = json.slice(1, -1);
  if (quote === "'") return inner.replace(/\\"/g, '"').replace(/'/g, "\\'");
  return inner;
}

/**
 * Static rewriting is limited to positions that can only be display text.
 * Short, keyless labels stay untouched in the bundle and are handled by the
 * runtime overlay instead, so a string that doubles as an internal key can
 * never change program behaviour.
 */
function isDisplaySafe(occ) {
  if (UI_KEYS.has(occ.propKey)) return true;
  const v = occ.value.trim();
  if (v.length >= 25) return true;
  if (/\s/.test(v) && v.length >= 12) return true;
  return false;
}

/**
 * Rewrites the given occurrences in place. `dictionary` maps English source
 * text to Russian; only occurrences marked replaceable are touched.
 */
export function applyDictionary(code, occurrences, dictionary, { skipStatic } = {}) {
  const edits = [];
  const used = new Map();
  for (const occ of occurrences) {
    if (occ.block) continue;
    if (!isDisplaySafe(occ)) continue;
    const target = dictionary.get(occ.value);
    if (target === undefined) continue;
    if (skipStatic && skipStatic.has(occ.value)) continue;
    // TemplateElement ranges already exclude the surrounding delimiters.
    const text =
      occ.kind === "quasi"
        ? encodeForQuote(target, "`")
        : occ.quote + encodeForQuote(target, occ.quote) + occ.quote;
    edits.push({ start: occ.start, end: occ.end, text });
    used.set(occ.value, (used.get(occ.value) || 0) + 1);
  }

  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  return { code: out, replacements: edits.length, used };
}
