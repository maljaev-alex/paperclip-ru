/**
 * Runtime resize for right-hand Paperclip columns the bundle leaves fixed:
 * Classic Task Interface properties, in-page detail sidebars (skills / artifacts
 * / similar split layouts), right sheets, and plugin drawers. In-page inspectors
 * live in a 2-column grid (`minmax(0,1fr) 18rem` / `--gtc-29` and siblings) and
 * MUST be classified as `detail` before docked `aside` properties — otherwise
 * width is written on the element and the grid column stays 18rem. The default
 * issue Properties pane already has a native splitter and is left alone.
 *
 * Handles live on document.body (position:fixed) so React reconciliation
 * cannot delete them. Width is forced with a data-attribute CSS rule and a
 * custom property, because React overwrites className and inline width.
 */
export function panelsOverlaySource() {
  return String.raw`(function () {
  "use strict";
  if (window.__paperclipRuPanels) return;

  var STORAGE_PREFIX = "paperclip-ru:panel-width:";
  var NATIVE_PROPERTIES_KEY = "taskChatRedesign.propertiesPaneWidth";
  var NATIVE_BACKUP_KEY = "paperclip-ru:native-properties-width";
  var MIN = { properties: 260, detail: 220, sheet: 240, drawer: 240 };
  var DEFAULT_W = { properties: 322, detail: 288, sheet: 384, drawer: 480 };
  var HANDLE_CLASS = "pc-ru-resize-handle";

  var attached = [];
  var dragging = null;
  var scanTimer = 0;
  var prevUserSelect = "";
  var placeRaf = 0;

  function css() {
    if (document.getElementById("pc-ru-panels-style")) return;
    var style = document.createElement("style");
    style.id = "pc-ru-panels-style";
    style.textContent =
      "[data-pc-ru-panel][data-pc-ru-open='1']{" +
        "width:var(--pc-ru-panel-width)!important;" +
        "max-width:none!important;" +
        "flex-shrink:0!important;" +
        "box-sizing:border-box!important;" +
      "}" +
      "[data-pc-ru-panel][data-pc-ru-open='1']>.w-80{" +
        "width:100%!important;" +
        "min-width:0!important;" +
        "max-width:none!important;" +
      "}" +
      "[data-pc-ru-grid='1']," +
      "[data-pc-ru-grid='1'][class*='gtc-29']," +
      "[data-pc-ru-grid='1'][class*='gtc-40']," +
      "[data-pc-ru-grid='1'][class*='gtc-45']{" +
        "grid-template-columns:minmax(0,1fr) var(--pc-ru-detail-col,18rem)!important;" +
      "}" +
      "[data-pc-ru-flex='1']>[data-pc-ru-panel]{" +
        "flex:0 0 var(--pc-ru-panel-width)!important;" +
        "width:var(--pc-ru-panel-width)!important;" +
      "}" +
      "." + HANDLE_CLASS + "{" +
        "position:fixed;width:14px;z-index:2147483000;cursor:col-resize;touch-action:none;" +
        "background:transparent;" +
      "}" +
      "." + HANDLE_CLASS + ":after{" +
        "content:'';display:block;margin:0 auto;height:100%;width:2px;" +
        "background:rgba(148,163,184,.55);transition:background-color .15s ease;" +
      "}" +
      "." + HANDLE_CLASS + ":hover:after," +
      "." + HANDLE_CLASS + "[data-dragging]:after{" +
        "background:var(--ring,var(--border,#94a3b8));" +
      "}" +
      "." + HANDLE_CLASS + "[hidden]{display:none!important;}" +
      "body.pc-ru-resizing,body.pc-ru-resizing *{cursor:col-resize!important;}" +
      "body.pc-ru-resizing{user-select:none!important;}";
    document.head.appendChild(style);
  }

  function num(v, fallback) {
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function maxFor(kind, el) {
    if (kind === "detail" && el && el.parentElement) {
      var pw = el.parentElement.getBoundingClientRect().width;
      return Math.max(MIN.detail, Math.round(pw - 360));
    }
    var reserved = kind === "properties" ? 656 : 96;
    return Math.max(MIN[kind], window.innerWidth - reserved);
  }

  function clamp(kind, width, el) {
    return Math.min(Math.max(Math.round(width), MIN[kind]), maxFor(kind, el));
  }

  function readWidth(kind, el) {
    try {
      var raw = localStorage.getItem(STORAGE_PREFIX + kind);
      if (raw != null) return clamp(kind, num(raw, DEFAULT_W[kind]), el);
      if (kind === "properties") {
        var native = localStorage.getItem(NATIVE_PROPERTIES_KEY);
        if (native != null) return clamp(kind, num(native, DEFAULT_W[kind]), el);
      }
    } catch (e) { /* private mode */ }
    return DEFAULT_W[kind];
  }

  // The upstream properties key is shared state, so the value it had before the
  // module first touched it is remembered and restored on reset instead of
  // being deleted with our own key.
  function rememberNative() {
    try {
      if (localStorage.getItem(NATIVE_BACKUP_KEY) != null) return;
      var native = localStorage.getItem(NATIVE_PROPERTIES_KEY);
      localStorage.setItem(NATIVE_BACKUP_KEY, native == null ? "" : native);
    } catch (e) { /* ignore quota / private mode */ }
  }

  function writeWidth(kind, width) {
    try {
      localStorage.setItem(STORAGE_PREFIX + kind, String(width));
      if (kind === "properties") {
        rememberNative();
        localStorage.setItem(NATIVE_PROPERTIES_KEY, String(width));
      }
    } catch (e) { /* ignore quota / private mode */ }
  }

  function clearWidth(kind) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + kind);
      if (kind !== "properties") return;
      var saved = localStorage.getItem(NATIVE_BACKUP_KEY);
      if (saved == null) return;
      if (saved === "") localStorage.removeItem(NATIVE_PROPERTIES_KEY);
      else localStorage.setItem(NATIVE_PROPERTIES_KEY, saved);
      localStorage.removeItem(NATIVE_BACKUP_KEY);
    } catch (e) { /* ignore */ }
  }

  function isCollapsed(el) {
    var w = el.style.width;
    return w === "0px" || w === "0" || el.style.opacity === "0";
  }

  function hasNativeLeftGrip(el) {
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.classList && k.classList.contains(HANDLE_CLASS)) continue;
      if (k.getAttribute("role") !== "separator") continue;
      var cls = String(k.className || "");
      if (cls.indexOf("cursor-col-resize") === -1) continue;
      var label = String(k.getAttribute("aria-label") || "").toLowerCase();
      if (label.indexOf("sidebar") !== -1) continue;
      if (label.indexOf("file tree") !== -1 || label.indexOf("skill folder") !== -1) continue;
      if (label.indexOf("board chat") !== -1) continue;
      return true;
    }
    return false;
  }

  function isLeftRail(el) {
    if (el.querySelector('[aria-label="Resize sidebar"]')) return true;
    var rect = el.getBoundingClientRect();
    return rect.left < 72 && rect.right < window.innerWidth * 0.55;
  }

  function visibleKids(parent) {
    var out = [];
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      var r = c.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      out.push(c);
    }
    return out;
  }

  function gridColumnCount(cs) {
    var raw = String(cs.gridTemplateColumns || "").trim();
    if (!raw || raw === "none") return 0;
    var parts = raw.split(/\s+(?![^()]*\))/);
    return parts.filter(Boolean).length;
  }

  function isSplitSidebar(el) {
    var parent = el.parentElement;
    if (!parent) return false;
    var cs = getComputedStyle(parent);
    var grid = cs.display === "grid";
    var row = grid || ((cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection !== "column");
    if (!row) return false;
    if (grid && gridColumnCount(cs) !== 2) return false;
    var kids = visibleKids(parent);
    if (kids.length < 2 || kids[kids.length - 1] !== el) return false;
    var pr = parent.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    if (pr.right - er.right > 48) return false;
    if (er.width < 180 || er.width > 720) return false;
    if (er.width > pr.width * 0.62) return false;
    var sib = kids[kids.length - 2].getBoundingClientRect();
    if (sib.width < 160) return false;
    if (sib.left >= er.left - 8) return false;
    return true;
  }

  function findSplitColumn(start) {
    var node = start;
    for (var depth = 0; depth < 6 && node && node.parentElement; depth++) {
      if (isSplitSidebar(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function isDockedProperties(el) {
    if (el.tagName !== "ASIDE") return false;
    var rect = el.getBoundingClientRect();
    if (window.innerWidth - rect.right > 32) return false;
    if (rect.height < window.innerHeight * 0.4 && rect.top > 120) return false;
    return true;
  }

  function classify(el) {
    if (!el || el.nodeType !== 1 || !el.isConnected) return null;
    if (el.classList.contains(HANDLE_CLASS)) return null;
    var rect = el.getBoundingClientRect();
    if (rect.height < 160) return null;
    if (rect.width < 12) return null;
    if (rect.left < 80) return null;
    if (isLeftRail(el) || hasNativeLeftGrip(el)) return null;
    var slot = el.getAttribute("data-slot");
    if (slot === "sheet-content") {
      if (window.innerWidth - rect.right > 40) return null;
      return "sheet";
    }
    if (findSplitColumn(el)) return "detail";
    if (isDockedProperties(el)) return "properties";
    var pos = window.getComputedStyle(el).position;
    if ((pos === "fixed" || pos === "absolute") && window.innerWidth - rect.right <= 32 && rect.height >= window.innerHeight * 0.45) {
      return "drawer";
    }
    return null;
  }

  function bindParent(rec) {
    var col = findSplitColumn(rec.el) || rec.el;
    var parent = col.parentElement;
    rec.parent = parent || rec.el.parentElement || null;
    if (!parent) return;
    var cs = getComputedStyle(parent);
    if (cs.display === "grid") {
      if (gridColumnCount(cs) === 2) parent.setAttribute("data-pc-ru-grid", "1");
      return;
    }
    if ((cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection !== "column") {
      parent.setAttribute("data-pc-ru-flex", "1");
    }
  }

  function unbindParent(rec) {
    var parent = rec.parent;
    if (!parent) return;
    parent.removeAttribute("data-pc-ru-grid");
    parent.removeAttribute("data-pc-ru-flex");
    parent.style.removeProperty("--pc-ru-detail-col");
  }

  function applyWidth(rec, width) {
    var next = clamp(rec.kind, width, rec.el);
    rec.el.style.setProperty("--pc-ru-panel-width", next + "px");
    rec.el.setAttribute("data-pc-ru-width", String(next));
    rec.width = next;
    if (!rec.parent) bindParent(rec);
    if (rec.parent && (rec.parent.hasAttribute("data-pc-ru-grid") || rec.parent.hasAttribute("data-pc-ru-flex"))) {
      rec.parent.style.setProperty("--pc-ru-detail-col", next + "px");
    }
    return next;
  }

  function placeHandle(rec) {
    var el = rec.el;
    var handle = rec.handle;
    if (!el.isConnected) {
      handle.hidden = true;
      return;
    }
    var closed = isCollapsed(el);
    rec.el.setAttribute("data-pc-ru-open", closed ? "0" : "1");
    if (closed) {
      handle.hidden = true;
      return;
    }
    var rect = el.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 40) {
      handle.hidden = true;
      return;
    }
    handle.hidden = false;
    handle.style.top = Math.max(0, rect.top) + "px";
    handle.style.height = Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)) + "px";
    handle.style.left = Math.max(0, rect.left - 2) + "px";
  }

  function schedulePlace() {
    if (placeRaf) return;
    placeRaf = window.requestAnimationFrame(function () {
      placeRaf = 0;
      for (var i = 0; i < attached.length; i++) placeHandle(attached[i]);
    });
  }

  function endDrag(persist) {
    if (!dragging) return;
    var d = dragging;
    dragging = null;
    d.handle.removeAttribute("data-dragging");
    document.body.classList.remove("pc-ru-resizing");
    document.body.style.userSelect = prevUserSelect;
    if (d.pointerId != null) {
      try { d.handle.releasePointerCapture(d.pointerId); } catch (e) { /* already released */ }
    }
    if (persist) writeWidth(d.kind, d.width);
    schedulePlace();
  }

  function startDrag(rec, handle, clientX, pointerId) {
    var startW = rec.width || num(rec.el.getAttribute("data-pc-ru-width"), rec.el.getBoundingClientRect().width);
    prevUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.classList.add("pc-ru-resizing");
    handle.setAttribute("data-dragging", "");
    dragging = {
      rec: rec,
      handle: handle,
      kind: rec.kind,
      pointerId: pointerId,
      startX: clientX,
      startW: startW,
      width: startW,
      mouse: pointerId == null
    };
  }

  function moveDrag(clientX, pointerId) {
    if (!dragging) return;
    if (pointerId != null && dragging.pointerId !== pointerId) return;
    dragging.width = applyWidth(dragging.rec, dragging.startW + (dragging.startX - clientX));
    placeHandle(dragging.rec);
  }

  function bindHandle(rec) {
    var handle = rec.handle;
    handle.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      startDrag(rec, handle, e.clientX, e.pointerId);
    });
    handle.addEventListener("pointermove", function (e) {
      if (!dragging || dragging.mouse) return;
      moveDrag(e.clientX, e.pointerId);
    });
    handle.addEventListener("pointerup", function (e) {
      if (!dragging || dragging.mouse) return;
      if (dragging.pointerId !== e.pointerId) return;
      endDrag(true);
    });
    handle.addEventListener("pointercancel", function () { if (dragging && !dragging.mouse) endDrag(true); });
    handle.addEventListener("lostpointercapture", function () {
      if (dragging && !dragging.mouse) endDrag(true);
    });
    handle.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      if (dragging) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(rec, handle, e.clientX, null);
    });
    handle.addEventListener("dblclick", function (e) {
      e.preventDefault();
      clearWidth(rec.kind);
      applyWidth(rec, DEFAULT_W[rec.kind]);
      placeHandle(rec);
    });
  }

  function attach(el, kind) {
    if (el.getAttribute("data-pc-ru-panel")) return;
    css();
    el.setAttribute("data-pc-ru-panel", kind);
    var handle = document.createElement("div");
    handle.className = HANDLE_CLASS;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "vertical");
    handle.setAttribute("aria-label", "Изменить ширину панели");
    handle.setAttribute("data-pc-ru-for", kind);
    document.body.appendChild(handle);
    var rec = { el: el, handle: handle, kind: kind, width: 0, parent: null };
    bindParent(rec);
    bindHandle(rec);
    applyWidth(rec, readWidth(kind, el));
    placeHandle(rec);
    attached.push(rec);
  }

  function collect() {
    var set = [];
    var seen = typeof WeakSet === "function" ? new WeakSet() : null;
    function add(list) {
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (seen) {
          if (seen.has(el)) continue;
          seen.add(el);
        }
        set.push(el);
      }
    }
    add(document.querySelectorAll("aside"));
    add(document.querySelectorAll("[data-slot='sheet-content']"));
    add(document.querySelectorAll("[role='dialog']"));
    add(document.querySelectorAll("div.grid > :last-child, [class*='grid-cols'] > :last-child"));
    add(document.querySelectorAll("[class*='border-l']"));
    return set;
  }

  function prune() {
    var next = [];
    for (var i = 0; i < attached.length; i++) {
      var rec = attached[i];
      if (rec.el.isConnected) {
        next.push(rec);
        continue;
      }
      if (rec.handle && rec.handle.parentNode) rec.handle.parentNode.removeChild(rec.handle);
      unbindParent(rec);
    }
    attached = next;
  }

  function scan() {
    if (dragging) return;
    prune();
    for (var i = 0; i < attached.length; i++) {
      if (!isCollapsed(attached[i].el)) applyWidth(attached[i], attached[i].width || readWidth(attached[i].kind, attached[i].el));
      placeHandle(attached[i]);
    }
    var nodes = collect();
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      var split = findSplitColumn(el);
      var target = split || el;
      if (target.getAttribute("data-pc-ru-panel")) continue;
      var found = classify(el);
      if (found) attach(found === "detail" && split ? split : target, found);
    }
  }

  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = window.setTimeout(function () {
      scanTimer = 0;
      scan();
    }, 40);
  }

  function onResize() {
    if (dragging) return;
    for (var i = 0; i < attached.length; i++) {
      var rec = attached[i];
      if (isCollapsed(rec.el)) continue;
      applyWidth(rec, rec.width || readWidth(rec.kind, rec.el));
      placeHandle(rec);
    }
    scheduleScan();
  }

  css();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scan);
  } else {
    scan();
  }
  window.addEventListener("resize", onResize);
  window.addEventListener("scroll", schedulePlace, true);
  var obs = new MutationObserver(scheduleScan);
  function watch() {
    if (!document.body) return;
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class", "data-state"] });
    scan();
  }
  if (document.body) watch();
  else document.addEventListener("DOMContentLoaded", watch);
  document.addEventListener("mousemove", function (e) {
    if (!dragging || !dragging.mouse) return;
    moveDrag(e.clientX, null);
  }, true);
  document.addEventListener("mouseup", function () {
    if (!dragging || !dragging.mouse) return;
    endDrag(true);
  }, true);

  var api = {
    scan: scan,
    attached: function () { return attached.map(function (r) { return { kind: r.kind, width: r.width }; }); }
  };
  window.__paperclipRuPanels = api;
  if (window.__paperclipRu) window.__paperclipRu.panels = api;
})();
`;
}
