import { panelsOverlaySource } from "./panels.mjs";

export const OVERLAY_FILE = "paperclip-ru-overlay.js";
export const INDEX_MARKER = "PAPERCLIP_RU_OVERLAY";

/**
 * Runtime translation layer. It hooks the DOM sinks React writes text through
 * (createTextNode, textContent/nodeValue setters, setAttribute) instead of
 * observing mutations, so translations survive re-renders without loops and
 * without a flash of English.
 */
function overlaySource() {
  return String.raw`(function () {
  "use strict";
  if (window.__paperclipRu) return;

  var DICT = Object.create(null);
  __DICT__.forEach(function (entry) { DICT[entry[0]] = entry[1]; });
  var RULES = __RULES__.map(function (r) {
    return { re: new RegExp(r.pattern, r.flags || ""), to: r.replace, scope: r.scope || "any" };
  });
  var PLURALS = Object.create(null);
  __PLURALS__.forEach(function (entry) { PLURALS[entry[0]] = entry[1]; });
  var META = __META__;

  var SKIP_TAGS = { CODE: 1, PRE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, KBD: 1, SAMP: 1 };
  var ATTRS = {
    title: 1, placeholder: 1, alt: 1, "aria-label": 1, "aria-description": 1,
    "aria-placeholder": 1, "aria-roledescription": 1, "aria-valuetext": 1, label: 1,
    "data-placeholder": 1
  };
  var CYRILLIC = /[\u0400-\u04FF]/;
  var LATIN = /[A-Za-z]/;
  var DIGITS = /^[\d./: -]+$/;
  var cache = new Map();
  var lower = Object.create(null);
  for (var k in DICT) {
    lower[k.toLowerCase()] = DICT[k];
    var kt = k.trim();
    if (kt && kt !== k && lower[kt.toLowerCase()] === undefined) {
      var kv = DICT[k];
      lower[kt.toLowerCase()] = typeof kv === "string" ? kv.replace(/^\s+/, "") : kv;
    }
  }

  function plural(n, one, few, many) {
    var v = Math.abs(parseInt(n, 10)) % 100;
    var d = v % 10;
    if (v > 10 && v < 20) return many;
    if (d === 1) return one;
    if (d >= 2 && d <= 4) return few;
    return many;
  }

  function lookup(text) {
    if (text == null) return null;
    var raw = String(text);
    if (DICT[raw] !== undefined) return DICT[raw];
    var t = raw.trim();
    if (!t) return null;
    if (DICT[t] !== undefined) return DICT[t];
    if (DICT[" " + t] !== undefined) return DICT[" " + t];
    var lc = lower[t.toLowerCase()];
    return lc !== undefined ? lc : null;
  }

  function format(tpl, m) {
    return tpl
      .replace(/\{plural:(\d+):([^}]*)\}/g, function (_, gi, forms) {
        var f = forms.split("|");
        return plural(m[+gi], f[0], f[1] !== undefined ? f[1] : f[0], f[2] !== undefined ? f[2] : f[0]);
      })
      // {t:N} substitutes the captured group after running it through the
      // dictionary, so composed phrases ("changed status from X to Y") get a
      // translated X and Y instead of leftover English.
      // {tl:N} additionally lowercases the first letter, for values embedded
      // mid-sentence where the dictionary form is capitalised. {r:N} runs the
      // whole translation pipeline on the group, so nested phrases such as the
      // "1h ago" inside "Finished 1h ago" also get translated.
      .replace(/\{(t|tl|r):(\d)\}/g, function (whole, mode, gi) {
        var raw = m[+gi];
        if (raw == null) return whole;
        var mapped = mode === "r" ? core(raw, "text") : lookup(raw);
        var out = mapped !== null ? mapped : raw;
        if (mode === "tl" && mapped !== null) out = out.charAt(0).toLowerCase() + out.slice(1);
        return out;
      })
      .replace(/\$(\d)/g, function (whole, gi) {
        return m[+gi] != null ? m[+gi] : whole;
      });
  }

  // The case-insensitive fallback is what lets one dictionary entry serve both
  // "Open" and "open", so the original capitalisation has to be carried over —
  // otherwise a heading silently turns into lower case.
  function recase(source, value) {
    if (!value) return value;
    var first = source.charAt(0);
    if (first !== first.toUpperCase() || first === first.toLowerCase()) return value;
    if (source.length > 1 && source === source.toUpperCase()) return value.toUpperCase();
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  var depth = 0;

  function core(text, scope) {
    // React renders English plurals as a separate "s" suffix node next to the
    // noun. Russian nouns carry their own ending, so the leftover suffix would
    // show up as a stray latin letter and is dropped instead.
    if (text === "s") return "";
    if (DICT[text] !== undefined) return DICT[text];
    if (DICT[" " + text] !== undefined) return String(DICT[" " + text]).replace(/^\s+/, "");
    var collapsed = text.replace(/\s+/g, " ");
    if (DICT[collapsed] !== undefined) return DICT[collapsed];
    if (DICT[" " + collapsed] !== undefined) return String(DICT[" " + collapsed]).replace(/^\s+/, "");
    var lc = lower[collapsed.toLowerCase()];
    if (lc !== undefined) return recase(collapsed, lc);

    // Machine event keys ("agent.status_changed") are rendered raw in the
    // activity feed; the dictionary holds their humanised form.
    if (/^[a-z][a-z0-9]*([._][a-z0-9]+)+$/.test(collapsed)) {
      var human = lower[collapsed.replace(/[._]/g, " ")];
      if (human !== undefined) return recase(collapsed, human);
    }

    // Bullet-joined composites (document titles, meta lines) are translated
    // piecewise before the rules get a chance to misread them as one phrase.
    if (collapsed.indexOf(" \u2022 ") !== -1) {
      var head = collapsed.split(" \u2022 ");
      var touched = false;
      var joined = head.map(function (p) {
        var r = lookup(p);
        if (r !== null) { touched = true; return r; }
        return p;
      });
      if (touched) return joined.join(" \u2022 ");
    }

    if (depth < 4) {
      depth += 1;
      try {
        for (var i = 0; i < RULES.length; i++) {
          if (RULES[i].scope !== "any" && RULES[i].scope !== scope) continue;
          RULES[i].re.lastIndex = 0;
          var m = RULES[i].re.exec(collapsed);
          if (m) return format(RULES[i].to, m);
        }
      } finally {
        depth -= 1;
      }
    }
    return null;
  }

  function translate(value, scope) {
    if (typeof value !== "string" || value.length === 0 || value.length > 600) return value;
    scope = scope || "text";
    var key = scope + "\u0000" + value;
    var hit = cache.get(key);
    if (hit !== undefined) return hit;
    var out = value;
    // Composed strings mix already-translated data with English chrome
    // ("Open <company> company switcher"), so the presence of Cyrillic must not
    // disqualify a string — only the absence of Latin letters does. Short
    // digit-only values still go through: chart axes carry US dates like "8/20"
    // that no dictionary word would ever match.
    if (LATIN.test(value) || (value.length <= 12 && DIGITS.test(value) && !CYRILLIC.test(value))) {
      var lead = value.match(/^\s*/)[0];
      var tail = value.match(/\s*$/)[0];
      var body = value.slice(lead.length, value.length - tail.length);
      if (body) {
        var mapped = core(body, scope);
        if (mapped !== null && mapped !== body) out = lead + mapped + tail;
      }
    }
    if (cache.size < 20000) cache.set(key, out);
    return out;
  }

  // "26 files" reaches the DOM as the nodes "26" and " file" + "s": the number
  // and the noun never meet in one string, so the {plural:N:...} rule syntax
  // cannot reach them. Once the noun node sits in the tree its previous sibling
  // holds the count, which is enough to pick the right Russian form.
  function agree(node, value) {
    if (!node || typeof value !== "string") return value;
    var forms = PLURALS[value.replace(/^\s+|\s+$/g, "")];
    if (!forms) return value;
    var prev = node.previousSibling;
    var count = prev && prev.nodeType === 3 ? String(prev.nodeValue).replace(/[\s\u00a0\u202f]/g, "") : "";
    if (!/^\d+$/.test(count)) return value;
    var lead = value.match(/^\s*/)[0];
    var tail = value.match(/\s*$/)[0];
    return lead + plural(count, forms[0], forms[1], forms[2]) + tail;
  }

  // Syntax highlighters wrap every token in its own <span>, so checking the
  // immediate parent is not enough: a lone "kind" inside a JSON sample would
  // otherwise be treated as a UI label. Inspect the complete ancestor chain.
  // Agent/skill markdown editors (Lexical / MDX / CodeMirror) must be skipped
  // entirely: rewriting their text marks the form dirty and pops a confirm
  // on every tab change.
  var CODE_CLASS = /(^|\s|_)(cm-|shiki|hljs|token|language-|code-block|prism|paperclip-markdown|paperclip-mdxeditor-content|prose|ProseMirror|mdxeditor|mdx-editor|lexical|editor-input|monaco-editor|ace_|w-md-editor|contentEditable)/;
  var EDITOR_ROLE = /^(textbox|searchbox)$/;

  function activitySummary(el) {
    return el.matches('span.shrink-0.truncate') && el.classList.contains('max-w-1/2') && el.querySelector('span.text-muted-foreground');
  }

  function userTextElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.closest('svg,[role="img"],.sr-only,[data-slot="badge"]')) return false;
    if (el.closest('[translate="no"], [data-testid="issue-detail-header"] h2, [data-testid="task-chat-composer-assignee"]')) return true;
    if (el.matches('span.inline-flex[title]') && el.querySelector('[data-slot="avatar"]') && el.querySelector('.truncate')) return true;
    // Official issue rows/cards render the user title separately from status
    // controls. Do not translate a title merely because it equals a UI label.
    if (el.matches('.line-clamp-2.text-sm') || (el.matches('.truncate[title]') && !activitySummary(el))) return true;
    // Company switcher entries pair the user name with the company prefix.
    if (el.matches('[role="menuitem"] > .truncate') && el.nextElementSibling && el.nextElementSibling.matches('.font-mono')) return true;
    if (el.matches('[role="menuitem"] .truncate[class*="organization-popover-name-line-height"]')) return true;
    var link = el.closest('a[href]');
    var entity = /^\/[^/]+\/(?:issues|agents|projects|goals|routines|cases|chats)\/(?!all(?:\/|$)|new(?:\/|$))[^/?#]+(?:\/|$)/;
    var nameLeaf = el.matches('.truncate:not(.text-muted-foreground), h3') || (el.matches('.font-medium') && !el.matches('.inline-flex'));
    // The streamlined shell puts the entity name directly in its breadcrumb
    // link; navigation labels are separate links without the truncate class.
    if (link === el && entity.test(link.getAttribute('href') || '') && el.matches('.truncate')) return true;
    if (link && el !== link && entity.test(link.getAttribute('href') || '') && nameLeaf && !el.closest('button,[role="img"],svg,[data-slot="badge"]')) return true;
    var current = window.location.pathname;
    if (entity.test(current)) {
      if (/^H[12]$/.test(el.tagName) && /(?:text-2xl|text-3xl)/.test(el.className || '')) return true;
      if (/\/projects\//.test(current) && el.matches('h2.text-xl.cursor-pointer')) return true;
      var crumb = el.closest('[data-slot="breadcrumb-page"]');
      if (crumb && (/\/(?:issues|projects)\//.test(current) || /\/agents\/[^/]+(?:\/dashboard)?\/?$/.test(current))) return true;
    }
    return false;
  }

  function inEditor(el) {
    if (!el || el.nodeType !== 1) return false;
    if (SKIP_TAGS[el.tagName]) return true;
    if (el.isContentEditable) return true;
    var ce = el.getAttribute && el.getAttribute("contenteditable");
    if (ce !== null && ce !== "false") return true;
    var role = el.getAttribute && el.getAttribute("role");
    if (role && EDITOR_ROLE.test(role)) return true;
    if (el.getAttribute && el.getAttribute("data-lexical-editor") != null) return true;
    var cls = el.getAttribute && el.getAttribute("class");
    if (cls && CODE_CLASS.test(cls)) return true;
    return false;
  }

  function isPlaceholderChrome(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return false;
    var ce = el.getAttribute && el.getAttribute("contenteditable");
    if (ce && ce !== "false") return false;
    var cls = (el.getAttribute && el.getAttribute("class")) || "";
    // CSS modules emit hashed classes like _placeholder_er3ed_1105; a word-boundary
    // match on placeholder fails because underscore is a word character.
    if (/(_placeholder_|editor-placeholder|lexical-placeholder|PlaygroundEditorTheme__placeholder|(?:^|\s)placeholder(?:\s|$))/i.test(cls)) return true;
    if (el.getAttribute && el.getAttribute("data-placeholder") != null && !inEditor(el)) return true;
    return false;
  }

  function allowed(node) {
    if (!node) return true;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return true;
    // Copy/wrap controls belong to the renderer, even inside protected prose.
    if (el.closest('button.paperclip-markdown-codeblock-action')) return true;
    if (userTextElement(el)) return false;
    if (isPlaceholderChrome(el) || (el.parentElement && isPlaceholderChrome(el.parentElement))) return true;
    for (var i = 0; el; i++, el = el.parentElement) {
      if (inEditor(el)) return false;
    }
    return true;
  }

  var natives = {};
  var hookFailures = [];

  function hookSetter(proto, prop, guard) {
    if (!proto) {
      hookFailures.push(prop + ":missing-proto");
      return false;
    }
    var d = Object.getOwnPropertyDescriptor(proto, prop);
    if (!d || typeof d.set !== "function") {
      hookFailures.push(prop + ":no-setter");
      return false;
    }
    try {
      natives[prop] = d.set;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: d.get,
        set: function (value) {
          if (typeof value === "string" && (!guard || guard(this))) {
            value = translate(value);
            if (this.nodeType === 3) value = agree(this, value);
          }
          d.set.call(this, value);
        }
      });
      return true;
    } catch (err) {
      hookFailures.push(prop + ":" + (err && err.message ? err.message : "define-failed"));
      return false;
    }
  }

  function liveUi(node) {
    if (!node || !node.isConnected) return false;
    return allowed(node);
  }

  hookSetter(Node.prototype, "textContent", liveUi);
  hookSetter(Node.prototype, "nodeValue", liveUi);
  hookSetter(window.CharacterData && CharacterData.prototype, "data", liveUi);
  hookSetter(window.HTMLElement && HTMLElement.prototype, "innerText", liveUi);
  hookSetter(Document.prototype, "title", null);

  // createTextNode is left native on purpose: the node has no parent yet, so
  // a short word from AGENTS.md ("not", "in") must not be rewritten before
  // Lexical reads it back. settle() applies the dictionary after attach.

  function settle(node, parent) {
    if (!node) return;
    if (node.nodeType === 1 || node.nodeType === 11) {
      if (node.nodeType === 1 && node.isConnected) settleAttributes(node);
      var kids = node.childNodes;
      for (var i = 0; i < kids.length; i++) settle(kids[i], node);
      return;
    }
    if (node.nodeType !== 3) return;
    if (!node.isConnected) return;
    if (!allowed(parent) || !allowed(node)) return;
    var next = agree(node, translate(node.nodeValue));
    if (next !== node.nodeValue) nativeNodeValue.call(node, next);
  }

  var nativeNodeValue = natives.nodeValue;

  if (nativeNodeValue) {
    var nativeAppend = Node.prototype.appendChild;
    Node.prototype.appendChild = function (child) {
      var frag = child && child.nodeType === 11;
      var out = nativeAppend.call(this, child);
      if (frag) {
        var kids = this.childNodes;
        for (var i = 0; i < kids.length; i++) settle(kids[i], this);
      } else {
        settle(out, this);
      }
      return out;
    };
    var nativeInsert = Node.prototype.insertBefore;
    Node.prototype.insertBefore = function (child, ref) {
      var frag = child && child.nodeType === 11;
      var out = nativeInsert.call(this, child, ref);
      if (frag) {
        var kids = this.childNodes;
        for (var i = 0; i < kids.length; i++) settle(kids[i], this);
      } else {
        settle(out, this);
      }
      return out;
    };
    var nativeReplace = Node.prototype.replaceChild;
    Node.prototype.replaceChild = function (child, old) {
      var frag = child && child.nodeType === 11;
      var out = nativeReplace.call(this, child, old);
      if (frag) {
        var kids = this.childNodes;
        for (var i = 0; i < kids.length; i++) settle(kids[i], this);
      } else {
        settle(child, this);
      }
      return out;
    };
  }

  function attributeAllowed(el, name) {
    if (name === "title" && el.matches('.truncate') && !activitySummary(el)) return false;
    if ((el.tagName === "INPUT" || el.tagName === "TEXTAREA") && /^(placeholder|aria-label|aria-description|aria-placeholder)$/.test(name)) return allowed(el.parentElement);
    return allowed(el);
  }

  var nativeSetAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    // React sets attributes before attaching an element and its ancestors.
    // Wait for that context, just as for text nodes, to protect user titles.
    if (this.isConnected && typeof value === "string" && typeof name === "string" && ATTRS[name.toLowerCase()] === 1 && attributeAllowed(this, name.toLowerCase())) {
      value = translate(value, "attr");
    }
    return nativeSetAttribute.call(this, name, value);
  };

  function settleAttributes(node) {
    for (var a in ATTRS) {
      if (!node.hasAttribute(a) || !attributeAllowed(node, a)) continue;
      var cur = node.getAttribute(a);
      var upd = translate(cur, "attr");
      if (upd !== cur) nativeSetAttribute.call(node, a, upd);
    }
  }

  function sweep(root) {
    if (!root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null);
    var node = walker.currentNode;
    while (node) {
      if (node.nodeType === 3) {
        if (allowed(node)) {
          var next = agree(node, translate(node.nodeValue));
          if (next !== node.nodeValue) node.nodeValue = next;
        }
      } else if (node.nodeType === 1) {
        settleAttributes(node);
      }
      node = walker.nextNode();
    }
  }

  // Dates, times and relative labels are produced by Intl/toLocale* with the
  // en-US locale hard-coded in the bundle. Rewriting the requested locale is
  // far more reliable than trying to translate every formatted result.
  function ruLocale(requested) {
    if (requested == null) return "ru-RU";
    var first = Array.isArray(requested) ? requested[0] : requested;
    if (typeof first !== "string") return "ru-RU";
    return /^en\b/i.test(first) || first === "" ? "ru-RU" : requested;
  }

  function localizeIntl() {
    // PluralRules is deliberately left alone: the bundle branches on the
    // English categories it returns, and ru categories would break that logic.
    var ctors = ["DateTimeFormat", "RelativeTimeFormat", "NumberFormat", "ListFormat"];
    for (var i = 0; i < ctors.length; i++) {
      (function (name) {
        var Native = window.Intl && window.Intl[name];
        if (typeof Native !== "function") return;
        function Patched(locales, options) {
          if (!(this instanceof Patched)) return new Patched(locales, options);
          return new Native(ruLocale(locales), options);
        }
        Patched.prototype = Native.prototype;
        Patched.supportedLocalesOf = function () {
          return Native.supportedLocalesOf.apply(Native, arguments);
        };
        try {
          window.Intl[name] = Patched;
        } catch (e) { /* frozen Intl: keep the native formatter */ }
      })(ctors[i]);
    }

    var methods = ["toLocaleDateString", "toLocaleTimeString", "toLocaleString"];
    for (var j = 0; j < methods.length; j++) {
      (function (name) {
        var native = Date.prototype[name];
        if (typeof native !== "function") return;
        Date.prototype[name] = function (locales, options) {
          return native.call(this, ruLocale(locales), options);
        };
      })(methods[j]);
    }
  }

  localizeIntl();

  // Compare-only tolerance for MDXEditor's initial serialization. User edits
  // always use exact comparison; window.confirm and navigation stay native.
  var touchedEditors = new WeakSet();
  function instructionEditor() {
    if (!/^\/[^/]+\/agents\/[^/]+\/(instructions|prompts)\/?$/.test(window.location.pathname)) return null;
    return document.querySelector("[data-lexical-editor], [contenteditable='true'].paperclip-mdxeditor-content, [contenteditable='true'].paperclip-mdxeditor");
  }
  function markInstructionEdit(e) {
    var editor = instructionEditor();
    if (editor && e.target && (editor === e.target || editor.contains(e.target))) touchedEditors.add(editor);
  }
  document.addEventListener("beforeinput", markInstructionEdit, true);
  document.addEventListener("input", markInstructionEdit, true);
  document.addEventListener("paste", markInstructionEdit, true);
  function instructionsEqual(a, b) {
    if (a === b) return true;
    var editor = instructionEditor();
    if (!editor || touchedEditors.has(editor)) return false;
    function normalize(s) {
      return String(s).replace(/\r\n?/g, "\n").replace(/^([ \t]*)[-*] /gm, "$1* ").replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
    }
    return normalize(a) === normalize(b);
  }

  function markLang() {
    try {
      document.documentElement.setAttribute("lang", "ru");
    } catch (e) { /* ignore */ }
  }

  markLang();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { markLang(); sweep(document.body); });
  } else {
    sweep(document.body);
  }

  window.__paperclipRu = {
    meta: META,
    translate: translate,
    instructionsEqual: instructionsEqual,
    dictionarySize: Object.keys(DICT).length,
    rules: RULES.length,
    diagnostics: {
      hookFailures: hookFailures,
      degraded: hookFailures.length > 0
    },
    resweep: function () { cache.clear(); sweep(document.body); },
    missing: function () {
      var seen = new Set();
      var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = w.nextNode())) {
        var t = (n.nodeValue || "").trim();
        if (t && /[A-Za-z]{2}/.test(t) && !CYRILLIC.test(t)) seen.add(t);
      }
      return Array.from(seen);
    }
  };
})();
`;
}

export function buildOverlay(dict, meta, { panelResize = false } = {}) {
  const payloads = {
    __DICT__: JSON.stringify([...dict.exact]),
    __RULES__: JSON.stringify(dict.rules),
    __PLURALS__: JSON.stringify(Object.entries(dict.plurals ?? {})),
    __META__: JSON.stringify(meta),
  };
  // A single callback substitution preserves literal $&, $`, $' and token-like
  // dictionary values; String.replace replacement strings interpret those bytes.
  const translation = overlaySource().replace(/__(?:DICT|RULES|PLURALS|META)__/g, (token) => payloads[token]);
  if (!panelResize) return translation;
  return (
    translation +
    "\ntry {\n" +
    panelsOverlaySource() +
    "\n} catch (e) { if (window.__paperclipRu) window.__paperclipRu.panelError = String(e && e.message || e); }\n"
  );
}

/** Patch the known Instructions comparison without changing saved/draft bytes. */
export function patchInstructionDirtyCompare(code) {
  if (code.includes("window.__paperclipRu.instructionsEqual(")) return { code, patched: true };
  const re = /((?:\?\?)?["']AGENTS\.md["']\)+),(\w+)=(\w+)!==null&&\3!==(\w+)/;
  const m = re.exec(code);
  if (!m) return { code, patched: false };
  const [, anchor, flag, draft, saved] = m;
  const compare = `${flag}=${draft}!==null&&!(typeof window!=="undefined"&&window.__paperclipRu?window.__paperclipRu.instructionsEqual(${draft},${saved}):${draft}===${saved})`;
  return { code: code.replace(m[0], `${anchor},${compare}`), patched: true };
}

/**
 * Upstream skill detail derives the active tab from `?tab=` OR from a leftover
 * `/files/...` path. Clicking Overview only deletes the query param, so after
 * browsing a file the tab cannot leave Files. Navigate back to the skill root
 * in that case. Unknown signatures are left untouched.
 */
export function patchSkillOverviewNavigation(code) {
  const ctRe = /function (\w+)\((\w+)\)\{(\w+)\((\w+)=>\{const (\w+)=new URLSearchParams\(\4\);return \2==="overview"\?\5\.delete\("tab"\):\5\.set\("tab",\2\),\5\}\)\}/;
  const m = ctRe.exec(code);
  if (!m) {
    return { code, patched: /delete\("tab"\):[^;]{0,180}hasExplicitFilePath/.test(code) };
  }
  const [full, ctName, tabArg, setSearch, searchArg, paramsName] = m;
  const from = Math.max(0, m.index - 4000);
  const around = code.slice(from, Math.min(code.length, m.index + 40000));
  const nnM = around.match(/(\w+)\.hasExplicitFilePath/);
  const navM = around.match(new RegExp(`onSelectPath:\\w+=>\\{${ctName}\\("files"\\),(\\w+)\\((\\w+)\\((\\w+),`));
  if (!nnM || !navM) return { code, patched: false };
  const nn = nnM[1];
  const navigate = navM[1];
  const toSkill = navM[2];
  const skillId = navM[3];
  const patchedFn = `function ${ctName}(${tabArg}){${setSearch}(${searchArg}=>{const ${paramsName}=new URLSearchParams(${searchArg});return ${tabArg}==="overview"?${paramsName}.delete("tab"):${paramsName}.set("tab",${tabArg}),${paramsName}}),${tabArg}==="overview"&&${nn}.hasExplicitFilePath&&${skillId}&&${navigate}(${toSkill}(${skillId}))}`;
  return { code: `${code.slice(0, m.index)}${patchedFn}${code.slice(m.index + full.length)}`, patched: true };
}

export function patchIndexHtml(html, stamp) {
  let out = html.replace(/<html([^>]*)\slang="[^"]*"/i, '<html$1 lang="ru"');
  if (!/lang="ru"/i.test(out)) out = out.replace(/<html\b/i, '<html lang="ru"');

  const tag =
    `    <!-- ${INDEX_MARKER}_START -->\n` +
    `    <script src="/assets/${OVERLAY_FILE}?v=${stamp}"></script>\n` +
    `    <!-- ${INDEX_MARKER}_END -->\n`;

  out = out.replace(new RegExp(`\\s*<!-- ${INDEX_MARKER}_START -->[\\s\\S]*?<!-- ${INDEX_MARKER}_END -->\\s*`, "g"), "\n");

  const moduleTag = out.match(/[ \t]*<script type="module"[^>]*><\/script>\n?/);
  if (moduleTag) {
    out = out.replace(moduleTag[0], tag + moduleTag[0]);
  } else {
    out = out.replace(/<\/head>/i, `${tag}  </head>`);
  }
  return out;
}
