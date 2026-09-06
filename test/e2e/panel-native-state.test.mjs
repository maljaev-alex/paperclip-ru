import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { buildOverlay } from "../../tools/lib/overlay.mjs";
import { loadDictionary } from "../../tools/lib/dictionary.mjs";

/**
 * The properties pane width is upstream state that the module mirrors for
 * interop. Resetting our handle must therefore restore whatever value the user
 * had before the module first wrote it, instead of deleting the key.
 */
// The aside is docked rather than a second grid/flex column, so panels.mjs
// classifies it as `properties` and mirrors the upstream width key.
const FIXTURE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>native properties</title>
<style>
  body { margin: 0; }
  #main { margin-right: 322px; height: 100vh; }
  aside#props {
    position: fixed; top: 0; right: 0;
    width: 322px; height: 100vh; border-left: 1px solid #333;
  }
</style>
</head>
<body>
  <div id="main">main content</div>
  <aside id="props">Properties</aside>
</body></html>`;

async function withPage(run, { seedNative }) {
  let playwright;
  try {
    playwright = await import("playwright");
  } catch {
    assert.fail("playwright обязателен в package-lock.json; проверка исходника не засчитывается");
  }
  const overlay = buildOverlay(loadDictionary(), { toolVersion: "1.0.0" }, { panelResize: true });
  const seed = seedNative === null
    ? ""
    : `<script>localStorage.setItem("taskChatRedesign.propertiesPaneWidth", ${JSON.stringify(String(seedNative))});</script>`;
  const html = FIXTURE.replace("</head>", `${seed}<script>${overlay}</script></head>`);
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const browser = await playwright.chromium.launch({ headless: true, channel: "chromium" });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => window.__paperclipRuPanels && window.__paperclipRuPanels.attached().length > 0);
    await run(page);
  } finally {
    await browser.close();
    server.close();
  }
}

const NATIVE_KEY = "taskChatRedesign.propertiesPaneWidth";

async function dragAndReset(page) {
  const handle = page.locator('.pc-ru-resize-handle[data-pc-ru-for="properties"]:not([hidden])').first();
  const box = await handle.boundingBox();
  assert.ok(box, "нет видимого handle у панели свойств");
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x - 80, box.y + 40, { steps: 8 });
  await page.mouse.up();
  const afterDrag = await page.evaluate((key) => ({
    ours: localStorage.getItem("paperclip-ru:panel-width:properties"),
    native: localStorage.getItem(key),
  }), NATIVE_KEY);
  await handle.dblclick();
  const afterReset = await page.evaluate((key) => ({
    ours: localStorage.getItem("paperclip-ru:panel-width:properties"),
    native: localStorage.getItem(key),
  }), NATIVE_KEY);
  return { afterDrag, afterReset };
}

test("сброс ширины возвращает исходное upstream-значение, а не удаляет его", async () => {
  await withPage(async (page) => {
    const { afterDrag, afterReset } = await dragAndReset(page);
    assert.ok(afterDrag.ours, "своя ширина должна сохраниться");
    assert.equal(afterDrag.native, afterDrag.ours, "для interop модуль зеркалит ширину в upstream-ключ");
    assert.equal(afterReset.ours, null, "своя запись удаляется при сбросе");
    assert.equal(afterReset.native, "455", "upstream-настройка пользователя восстановлена, а не потеряна");
  }, { seedNative: 455 });
});

test("если upstream-ключа не было, сброс не оставляет чужую запись", async () => {
  await withPage(async (page) => {
    const { afterReset } = await dragAndReset(page);
    assert.equal(afterReset.ours, null);
    assert.equal(afterReset.native, null, "модуль не должен создавать upstream-настройку, которой не было");
  }, { seedNative: null });
});

test("вставленный модулем handle имеет русское доступное имя", async () => {
  await withPage(async (page) => {
    const meta = await page.evaluate(() => {
      const handle = document.querySelector(".pc-ru-resize-handle");
      return {
        label: handle.getAttribute("aria-label"),
        role: handle.getAttribute("role"),
        orientation: handle.getAttribute("aria-orientation"),
      };
    });
    assert.equal(meta.role, "separator");
    assert.equal(meta.orientation, "vertical");
    assert.match(meta.label, /[\u0400-\u04ff]/, `доступное имя должно быть на русском, получено ${JSON.stringify(meta.label)}`);
  }, { seedNative: null });
});
