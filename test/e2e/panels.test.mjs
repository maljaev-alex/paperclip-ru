import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { loadDictionary } from "../../tools/lib/dictionary.mjs";
import { buildOverlay } from "../../tools/lib/overlay.mjs";

const FIXTURE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Panel resize fixture</title>
  <style>
    html,body { margin:0; height:100%; background:#111; color:#eee; font:14px sans-serif; }
    #skill-layout {
      display:grid;
      grid-template-columns:minmax(0,1fr) 18rem;
      width:1200px;
      height:720px;
    }
    #skill-main { min-width:0; height:100%; padding:12px; }
    #skill-inspector {
      min-width:0; height:100%;
      border-left:1px solid #444;
      padding:12px;
    }
    #classic-row { display:flex; width:1200px; height:420px; }
    #classic-chat { flex:1 1 auto; min-width:0; }
    #classic-props { width:320px; height:100%; border-left:1px solid #444; }
    #native-props {
      position:absolute; right:0; top:0; width:320px; height:400px;
      border-left:1px solid #666;
    }
    #nested-layout {
      display:grid;
      grid-template-columns:minmax(0,1fr) 18rem;
      width:1200px;
      height:400px;
    }
    #nested-col { min-width:0; height:100%; border-left:1px solid #555; }
    #nested-inspector { height:100%; padding:12px; }
  </style>
</head>
<body>
  <div id="skill-layout">
    <main id="skill-main">
      <textarea id="editor">AGENTS.md must stay</textarea>
      <div class="paperclip-task-chat-composer">composer intact</div>
    </main>
    <aside id="skill-inspector" class="xl:border-l border-border">
      <div>РАСПОЛОЖЕНИЕ</div>
      <div>ТЕГИ</div>
      <div>Агенты</div>
    </aside>
  </div>
  <div id="nested-layout">
    <main>artifact body</main>
    <div id="nested-col">
      <aside id="nested-inspector">
        <div>Источник</div>
        <div>Теги</div>
      </aside>
    </div>
  </div>
  <div id="classic-row">
    <div id="classic-chat">chat</div>
    <aside id="classic-props"><div class="w-80">Свойства</div></aside>
  </div>
  <aside id="native-props">
    <div role="separator" class="cursor-col-resize" aria-label="Resize properties">grip</div>
    Properties
  </aside>
</body>
</html>`;

async function withBrowser(t, run) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    assert.fail("playwright обязателен в package-lock.json; source inspection не засчитывается");
  }
  const browser = await playwright.chromium.launch({ headless: true, channel: "chromium" });
  const overlay = buildOverlay(loadDictionary(), { toolVersion: "1.0.0" }, { panelResize: true });
  const html = FIXTURE.replace("</head>", `<script>${overlay}</script></head>`);
  const serverHttp = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => serverHttp.listen(0, "127.0.0.1", r));
  const { port } = serverHttp.address();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await page.waitForFunction(() => window.__paperclipRuPanels && window.__paperclipRuPanels.attached().length > 0);
    await run(page);
  } finally {
    await browser.close();
    serverHttp.close();
  }
}

test("инспектор навыка в 2-колоночной сетке ресайзится и сохраняет ширину", async (t) => {
  await withBrowser(t, async (page) => {
    const before = await page.evaluate(() => {
      const el = document.getElementById("skill-inspector");
      return {
        kind: el.getAttribute("data-pc-ru-panel"),
        width: el.getBoundingClientRect().width,
        grid: getComputedStyle(document.getElementById("skill-layout")).gridTemplateColumns,
        editor: document.getElementById("editor").value,
        composer: document.querySelector(".paperclip-task-chat-composer").textContent,
        nativeKind: document.getElementById("native-props").getAttribute("data-pc-ru-panel"),
        handles: document.querySelectorAll(".pc-ru-resize-handle:not([hidden])").length,
        attached: window.__paperclipRuPanels.attached(),
      };
    });
    assert.equal(before.kind, "detail");
    assert.equal(before.nativeKind, null);
    assert.equal(before.editor, "AGENTS.md must stay");
    assert.match(before.composer, /composer intact/);
    assert.ok(before.handles >= 1);
    assert.ok(before.attached.some((x) => x.kind === "detail"));

    const handle = page.locator('.pc-ru-resize-handle[data-pc-ru-for="detail"]:not([hidden])').first();
    const box = await handle.boundingBox();
    assert.ok(box, "нет видимого handle у инспектора");
    await page.mouse.move(box.x + box.width / 2, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x - 90, box.y + 40, { steps: 8 });
    await page.mouse.up();

    const after = await page.evaluate(() => {
      const el = document.getElementById("skill-inspector");
      return {
        width: el.getBoundingClientRect().width,
        stored: localStorage.getItem("paperclip-ru:panel-width:detail"),
        nativeStored: localStorage.getItem("taskChatRedesign.propertiesPaneWidth"),
        editor: document.getElementById("editor").value,
        grid: getComputedStyle(document.getElementById("skill-layout")).gridTemplateColumns,
      };
    });
    assert.ok(after.width > before.width + 40, `ширина ${before.width} → ${after.width}`);
    assert.ok(after.stored, "ширина не сохранена в localStorage");
    assert.ok(Math.abs(Number(after.stored) - after.width) <= 2, `stored ${after.stored} vs box ${after.width}`);
    assert.equal(after.nativeStored, null);
    assert.equal(after.editor, "AGENTS.md must stay");
    assert.match(after.grid, new RegExp(`${after.stored}px`));

    const nested = await page.evaluate(() => {
      const col = document.getElementById("nested-col");
      return {
        kind: col.getAttribute("data-pc-ru-panel"),
        width: col.getBoundingClientRect().width,
        grid: getComputedStyle(document.getElementById("nested-layout")).gridTemplateColumns,
      };
    });
    assert.equal(nested.kind, "detail");
    assert.ok(nested.width >= 180, `вложенная колонка ${nested.width}`);
    assert.match(nested.grid, /px/);
  });
});
