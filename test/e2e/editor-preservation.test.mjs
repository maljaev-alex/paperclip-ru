import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chromium } from "playwright";
import { loadDictionary } from "../../tools/lib/dictionary.mjs";
import { buildOverlay, patchInstructionDirtyCompare } from "../../tools/lib/overlay.mjs";

test("editable/model bytes, placeholder, automatic serialization and real navigation guard", async (t) => {
  const stored = "# AGENTS.md\r\n\r\n- Open  \r\n- Dashboard\r\n\r\n";
  const content = "Open\r\nDashboard\n  keep trailing spaces  \nКириллица 🙂";
  const overlay = buildOverlay(loadDictionary(), { toolVersion: "test" });
  const app = patchInstructionDirtyCompare(`
    const saved=${JSON.stringify(stored)};
    let draft=null;
    const editor=document.querySelector('#instructions');
    editor.textContent=saved;
    const protectedText=${JSON.stringify(content)};
    for (const el of document.querySelectorAll('.protected')) {
      if(el.tagName==='TEXTAREA') el.value=protectedText;
      else { const span=document.createElement('span');span.textContent=protectedText;el.appendChild(span); }
    }
    function dirty(){const name=((null)??"AGENTS.md"),isDirty=draft!==null&&draft!==saved;return isDirty;}
    // The editor's initial markdown serialization changes presentation bytes.
    draft=saved.replace(/\\r\\n/g,'\\n').replace(/^- /gm,'* ').replace(/[ \\t]+$/gm,'').replace(/\\n+$/,'');
    editor.addEventListener('input',()=>{draft=editor.textContent;});
    document.querySelector('#leave').addEventListener('click',e=>{
      e.preventDefault();
      if(dirty()&&!confirm('Discard unsaved agent configuration changes?'))return;
      history.pushState({},'',e.currentTarget.getAttribute('href'));
    });
    window.fixture={stored:saved, getDraft:()=>draft, dirty, protectedText};
    document.querySelector('#save').onclick=()=>{window.fixture.savedPayload=JSON.stringify({content:draft});};
    document.querySelector('#unrelated').onclick=()=>confirm('Delete this project?');
  `).code;
  const server = http.createServer((req, res) => {
    if (req.url === "/overlay.js" || req.url === "/app.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(req.url === "/overlay.js" ? overlay : app);
    } else {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">${req.url.includes("plain=1") ? "" : '<script src="/overlay.js"></script>'}</head>
      <body><h1>Instructions</h1><div id="instructions" role="textbox" contenteditable="true" data-lexical-editor="true" class="paperclip-mdxeditor-content"></div>
      <textarea id="composer" placeholder="Message the agent — describe what you want done…"></textarea>
      <textarea class="protected"></textarea><pre class="protected"></pre><code class="protected"></code>
      <div class="prose protected"></div><div contenteditable="true" class="protected"></div>
      <div class="cm-content protected"></div><a id="leave" href="/CMP/agents/test/configuration">Configuration</a>
      <button id="save">Save</button><button id="unrelated">Delete project</button><script src="/app.js"></script></body></html>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch({ headless: true, channel: "chromium" });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [], dialogs = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  const url = `http://127.0.0.1:${server.address().port}/CMP/agents/test/instructions`;
  await page.goto(url + "?plain=1");
  const nativeProtected = await page.locator(".protected").evaluateAll(es => es.map(e => e.tagName === "TEXTAREA" ? e.value : e.textContent));
  await page.locator('#instructions').focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' ');
  await page.locator('#save').click();
  const nativeSavedPayload = await page.evaluate(() => window.fixture.savedPayload);
  await page.goto(url);
  const read = () => page.evaluate(() => ({
    stored: Array.from(new TextEncoder().encode(window.fixture.stored)),
    editor: document.querySelector('#instructions').textContent,
    protected: Array.from(document.querySelectorAll('.protected'), e => e.tagName === 'TEXTAREA' ? e.value : e.textContent),
    dirty: window.fixture.dirty(),
  }));
  const before = await read();
  assert.deepEqual(before.stored, [...Buffer.from(stored)]);
  assert.equal(before.editor, stored);
  assert.deepEqual(before.protected, nativeProtected);
  assert.equal(before.dirty, false);
  await page.evaluate(() => window.__paperclipRu.resweep());
  assert.deepEqual(await read(), before);
  assert.match(await page.locator('#composer').getAttribute('placeholder'), /агенту/);
  await page.locator('#composer').fill('Open Dashboard user message');
  assert.equal(await page.locator('#composer').inputValue(), 'Open Dashboard user message');
  await page.locator('#leave').click();
  assert.equal(dialogs.length, 0, 'untouched instructions must navigate without a false dirty prompt');
  assert.match(page.url(), /configuration$/);
  await page.goto(url);
  // Even a whitespace-only user edit must stay dirty.
  await page.locator('#instructions').focus();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.insertText(' ');
  assert.equal(await page.evaluate(() => window.fixture.dirty()), true);
  await page.locator('#save').click();
  assert.equal(await page.evaluate(() => window.fixture.savedPayload), nativeSavedPayload);
  await page.locator('#leave').click();
  assert.equal(dialogs.length, 1, 'real user edit must invoke the native navigation guard');
  assert.equal(page.url(), url, 'dismissed guard must preserve the editor');
  await page.locator('#unrelated').click();
  assert.equal(dialogs.length, 2, 'unrelated native confirmation must be preserved');
  assert.deepEqual(errors, []);
});
