#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { makeTempServer, runTool, assertInsideTmp } from "../test/helpers/copy-fixture.mjs";
import { verifyInstall } from "./lib/apply.mjs";
import { hashFile } from "./lib/fs-atomic.mjs";
import { classifyEnglish } from '../test/helpers/route-allowlist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const requiredRoutes = () => JSON.parse(fs.readFileSync(path.join(HERE, "routes.json"), "utf8"));

function localUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error("route-matrix requires an explicit local test server URL");
  return url.origin;
}

export async function waitForRouteContent(page, { timeout = 15000, requireRouteTitle = true } = {}) {
  // networkidle and the overlay can precede router hydration. The bare brand
  // title belongs to the loading shell; a route title may still be untranslated
  // here, so the existing language assertion remains an independent check.
  await page.waitForFunction((needsRouteTitle) => {
    const title = document.title.trim();
    return Boolean(window.__paperclipRu && document.body.textContent.trim()
      && (!needsRouteTitle || (title && title !== 'Paperclip')));
  }, requireRouteTitle, { timeout });
}

export async function generateRouteMatrix({ output, serverDir, baseUrl, companyPrefix = "CMP", extraRoutes = [], screenshotsDir, userValues = [], companyPrefixes = [companyPrefix], viewports = [{ width: 1440, height: 900 }, { width: 390, height: 844 }] } = {}) {
  if (serverDir && !baseUrl) throw new Error("Official route coverage requires --base-url of a running Paperclip server");
  if (baseUrl && !serverDir) throw new Error("--base-url requires --server-dir to verify the served bundle");
  if (!/^[A-Z0-9]+$/.test(companyPrefix)) throw new Error("Invalid company prefix");
  const synthetic = !serverDir;
  const server = serverDir || makeTempServer({ label: "route-matrix" });
  const ui = path.join(server, "ui-dist");
  let httpServer;
  let browser;
  try {
    if (synthetic) {
      const applied = await runTool(["apply", "--json", "--server-dir", server]);
      if (applied.code !== 0) throw new Error(applied.stdout + applied.stderr);
      httpServer = http.createServer((req, res) => {
        const pathname = new URL(req.url, "http://127.0.0.1").pathname;
        const asset = pathname === "/assets/paperclip-ru-overlay.js" ? "assets/paperclip-ru-overlay.js" : pathname === "/assets/app.js" ? "assets/app.js" : "index.html";
        res.writeHead(200, { "content-type": asset.endsWith('.js') ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8" });
        res.end(fs.readFileSync(path.join(ui, asset)));
      });
      await new Promise((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${httpServer.address().port}`;
    } else if (!verifyInstall({ serverDir }).ok) throw new Error("verify must succeed before the official route audit");
    baseUrl = localUrl(baseUrl);
    const served = await fetch(`${baseUrl}/assets/paperclip-ru-overlay.js`);
    if (!served.ok || sha(Buffer.from(await served.arrayBuffer())) !== hashFile(path.join(ui, "assets/paperclip-ru-overlay.js"))) throw new Error("Running server does not serve the selected patched bundle");
    const version = JSON.parse(fs.readFileSync(path.join(server, "package.json"), "utf8")).version;
    browser = await chromium.launch({ headless: true, channel: "chromium" });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], visited = [], runtimeLeaks = [], candidates = [], allowedEnglish = [], dynamicOrUnverifiable = [], surfaceProbes = [];
    let currentRoute = null;
    page.on("pageerror", (e) => errors.push({ route: currentRoute, type: "pageerror", message: String(e) }));
    page.on("console", (e) => { if (e.type() === "error") errors.push({ route: currentRoute, type: "console.error", message: e.text(), location: e.location() }); });
    page.on("dialog", async (d) => { errors.push({ route: currentRoute, type: "unexpected-dialog", message: d.message() }); await d.dismiss(); });
    // A one-page fixture proves one route. Only the official application can
    // supply evidence for the complete public route inventory.
    const routes = synthetic ? ["/CMP/dashboard"] : [...requiredRoutes().map((r) => r.replace("/CMP/", `/${companyPrefix}/`)), ...extraRoutes];
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    const readState = () => page.evaluate(() => {
        const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        const text = [];
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
          const el = n.parentElement;
          if (!visible(el) || el.closest("textarea,input,pre,code,kbd,samp,script,style,[contenteditable='true'],.prose,.paperclip-markdown,.cm-content")) continue;
          const value = n.nodeValue.trim();
          if (/[A-Za-z]{2}/.test(value)) text.push({ value, tag: el.tagName, className: el.className });
        }
        for (const el of document.querySelectorAll('[placeholder],[aria-label],[title]')) {
          if (!visible(el) || el.closest('pre,code,.prose,[contenteditable="true"],.cm-content')) continue;
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const value = el.getAttribute(attribute)?.trim();
            if (value && /[A-Za-z]{2}/.test(value)) text.push({ value, tag: el.tagName, className: el.className, attribute });
          }
        }
        return { lang: document.documentElement.lang, title: document.title,
          heading: Array.from(document.querySelectorAll('h1,h2')).filter(visible).map(e => e.textContent),
          body: document.body.innerText, candidates: text,
          hookFailures: window.__paperclipRu.diagnostics.hookFailures,
          placeholder: document.querySelector('textarea.composer-placeholder')?.getAttribute('placeholder') ?? null };
      });
    const auditCandidates = (state, route, viewport) => {
      const values = [...state.candidates, { value: state.title, attribute: 'document-title' }].filter(c => /[A-Za-z]{2}/.test(c.value));
      for (const candidate of values) {
        const reason = classifyEnglish(candidate, { companyPrefixes, userValues });
        if (reason) allowedEnglish.push({ route, viewport, ...candidate, reason });
        else runtimeLeaks.push({ route, viewport, reason: 'unclassified-English', ...candidate });
      }
    };
    // Select, menu and popover content is mounted only while the surface is
    // open, so an initial-render snapshot cannot see it. Each disclosure
    // trigger is opened, its portal content sampled, then closed again.
    const SURFACE_ROOTS = "[data-radix-popper-content-wrapper],[role='listbox'],[role='menu'],[role='dialog'],[role='tooltip'],[data-slot='sheet-content']";
    const readSurface = () => page.evaluate((roots) => {
      const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
      const text = [];
      for (const surface of document.querySelectorAll(roots)) {
        if (!visible(surface)) continue;
        const walk = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = walk.nextNode())) {
          const el = n.parentElement;
          if (!visible(el) || el.closest("textarea,input,pre,code,kbd,samp,script,style,[contenteditable='true'],.prose,.paperclip-markdown,.cm-content")) continue;
          const value = n.nodeValue.trim();
          if (/[A-Za-z]{2}/.test(value)) text.push({ value, tag: el.tagName, className: el.className, surface: true });
        }
        for (const el of surface.querySelectorAll('[placeholder],[aria-label],[title]')) {
          if (!visible(el)) continue;
          for (const attribute of ['placeholder', 'aria-label', 'title']) {
            const value = el.getAttribute(attribute)?.trim();
            if (value && /[A-Za-z]{2}/.test(value)) text.push({ value, tag: el.tagName, className: el.className, attribute, surface: true });
          }
        }
      }
      return { candidates: text, open: document.querySelectorAll(roots).length };
    }, SURFACE_ROOTS);
    const DESTRUCTIVE = /delete|remove|удал|archive|архив|revoke|отозв|reset|сброс|leave|purge|disband|уволь/i;
    const probeSurfaces = async (route, viewport) => {
      const triggers = await page.$$([
        "[role='combobox']:not([aria-expanded='true'])",
        "[data-slot='select-trigger']:not([aria-expanded='true'])",
        "[aria-haspopup='listbox'][aria-expanded='false']",
        "[aria-haspopup='menu'][aria-expanded='false']",
        "[aria-haspopup='dialog'][aria-expanded='false']",
        "[aria-haspopup='true'][aria-expanded='false']",
      ].join(","));
      let opened = 0;
      for (const trigger of triggers.slice(0, 14)) {
        try {
          const label = await trigger.evaluate((el) => `${el.textContent || ""} ${el.getAttribute("aria-label") || ""}`);
          if (DESTRUCTIVE.test(label)) continue;
          if (!(await trigger.isVisible()) || !(await trigger.isEnabled())) continue;
          await trigger.click({ timeout: 3000 });
          await page.waitForTimeout(180);
          const surface = await readSurface();
          if (!surface.candidates.length) { await page.keyboard.press("Escape").catch(() => {}); continue; }
          opened += 1;
          auditCandidates({ candidates: surface.candidates, title: "" }, route, viewport);
          candidates.push(...surface.candidates.map((c) => ({ route, ...c })));
          await page.keyboard.press("Escape");
          await page.waitForTimeout(120);
        } catch {
          await page.keyboard.press("Escape").catch(() => {});
        }
      }
      surfaceProbes.push({ route, viewport, triggersFound: triggers.length, surfacesSampled: opened });
      return opened;
    };
    for (const route of routes) {
      currentRoute = route;
      await page.setViewportSize(viewports[0]);
      await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle", timeout: 45000 });
      await waitForRouteContent(page, { requireRouteTitle: !synthetic });
      const board = !synthetic && new URL(`${baseUrl}${route}`).searchParams.get('view') === 'board';
      if (board) {
        await page.getByRole('button', { name: 'Доска', exact: true }).click();
        await page.locator('main [role="button"].cursor-grab').first().waitFor();
      }
      const state = await readState();
      if (state.lang !== 'ru' || state.hookFailures.length) runtimeLeaks.push({ route, reason: 'overlay-initialization', details: state.hookFailures });
      if (synthetic && (!state.heading.includes('Обзор') || !/агенту/.test(state.placeholder || ''))) runtimeLeaks.push({ route, reason: 'fixture-heading-placeholder' });
      if (!synthetic && /Page not found|Страница не найдена/.test(state.body)) runtimeLeaks.push({ route, reason: 'unresolved-route' });
      if (!synthetic && !/[\u0400-\u04ff]/.test(state.title)) runtimeLeaks.push({ route, reason: 'document-title', value: state.title });
      const resolved = new URL(page.url()).pathname;
      if (resolved !== route.split('?')[0]) dynamicOrUnverifiable.push({ route, finalPath: resolved, reason: 'official-router-redirect-or-disabled-feature' });
      auditCandidates(state, route, viewports[0]);
      candidates.push(...state.candidates.map((c) => ({ route, ...c })));
      await probeSurfaces(route, viewports[0]);
      const renders = [];
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.reload({ waitUntil: 'networkidle' });
        await waitForRouteContent(page, { requireRouteTitle: !synthetic });
        auditCandidates(await readState(), route, viewport);
        if (board && await page.locator('main [role="button"].cursor-grab').count() === 0) runtimeLeaks.push({ route, reason: 'board-not-rendered', viewport });
        const reload = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, overflow: document.documentElement.scrollWidth - innerWidth, hooks: window.__paperclipRu?.diagnostics.hookFailures }));
        if (reload.lang !== 'ru' || !Array.isArray(reload.hooks) || reload.hooks.length) runtimeLeaks.push({ route, reason: 'hard-reload-initialization', viewport });
        if (reload.overflow > 1) runtimeLeaks.push({ route, reason: 'horizontal-overflow', viewport, pixels: reload.overflow });
        renders.push({ viewport, ...reload, cacheDisabled: true });
      }
      if (screenshotsDir && [ `/${companyPrefix}/dashboard`, `/${companyPrefix}/issues` ].includes(route)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
        await page.setViewportSize(viewports[0]);
        await page.screenshot({ path: path.join(screenshotsDir, `${route.split('/').pop()}.png`) });
      }
      const surfacesSampled = surfaceProbes.filter((p) => p.route === route).reduce((sum, p) => sum + p.surfacesSampled, 0);
      visited.push({ route, finalPath: resolved, lang: state.lang, title: state.title, heading: state.heading, visibleTextSha256: sha(state.body), renders, surfacesSampled });
    }
    const matrix = { schema: "paperclip-ru-route-matrix/v1", provenance: { generator: "tools/generate-route-matrix.mjs", seed: "tools/routes.json", fixture: synthetic ? "single-dashboard-fixture" : "official-running-server", synthetic, browser: browser.version(), transientSurfaces: "selects, menus, popovers and tooltips are opened and sampled per route" }, timestamp: new Date().toISOString(), paperclipVersion: version, routes: visited, errors, runtimeLeaks, candidates,
      allowedEnglish, dynamicOrUnverifiable: synthetic ? [{ reason: "The remaining routes require the official running application" }] : dynamicOrUnverifiable, surfaceProbes };
    const dest = path.resolve(output || path.join(os.tmpdir(), "paperclip-ru-route-matrix.json"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, `${JSON.stringify(matrix, null, 2)}\n`);
    return { dest, matrix };
  } finally {
    if (browser) await browser.close();
    if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
    if (synthetic) fs.rmSync(assertInsideTmp(server), { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  const names = { '--output': 'output', '--server-dir': 'serverDir', '--base-url': 'baseUrl', '--company-prefix': 'companyPrefix' };
  try {
    for (let i = 2; i < process.argv.length; i++) {
      const key = names[process.argv[i]];
      const value = process.argv[++i];
      if (!key || !value || value.startsWith('--')) throw new Error('Invalid route-matrix arguments');
      options[key] = value;
    }
    const { dest, matrix } = await generateRouteMatrix(options);
    const ok = !matrix.errors.length && !matrix.runtimeLeaks.length;
    console.log(JSON.stringify({ ok, output: dest, routes: matrix.routes.length, errors: matrix.errors.length, runtimeLeaks: matrix.runtimeLeaks.length, candidates: matrix.candidates.length }));
    if (!ok) process.exitCode = 1;
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
