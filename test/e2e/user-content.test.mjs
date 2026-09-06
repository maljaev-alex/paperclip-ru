import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadDictionary } from '../../tools/lib/dictionary.mjs';
import { buildOverlay } from '../../tools/lib/overlay.mjs';

test('entity names stay intact while adjacent status, activity and accessibility chrome translate', async (t) => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/CMP/issues');
  await page.addScriptTag({ content: buildOverlay(loadDictionary(), { toolVersion: 'test' }) });
  await page.evaluate(() => {
    document.body.innerHTML = `<a href="/CMP/issues/CMP-1"><span id="task" class="line-clamp-2 text-sm">Dashboard</span><span id="status" class="inline-flex rounded-full font-medium">in progress</span><span id="time">2m ago</span></a>
      <a href="/CMP/agents/settings"><span id="agent" class="truncate">Settings</span><span id="role">General</span></a>
      <a href="/CMP/issues/CMP-1" class="font-medium" id="open">Open</a>
      <a href="/CMP/agents/settings"><p class="truncate"><span id="actor">Board</span><span id="event">updated</span><span id="activity-name" class="font-medium">Settings</span></p></a>
      <svg role="img" id="blocked" aria-label="Blocked · 0 блокировки требуют attention"></svg>
      <button id="change" aria-label="Change status (current: Blocked · 0 блокировки требуют attention)"></button>
      <span id="reason" aria-label="Reason: Цепочка блокировок встала, severity high"></span>
      <a id="decisions" aria-label="Решения, 21 decisions"></a>
      <span id="system-error">Agent is not invokable in its current state</span>
      <span id="variables-hint">Variables are auto-detected from <code>{{placeholders}}</code> in the title &amp; instructions. The variable name is read-only — rename by editing the placeholder.</span>
      <span id="filter-any">any</span>
      <span id="trigger-count">1 trigger</span>
      <span id="execution-result">Execution failed</span>
      <span id="routine-status">failed</span>
      <span id="routine-status-line">05.09.2026, 17:26:30<!-- React split --> · failed</span>
      <button id="last-run" aria-label="Last run failed. Open runs."></button>
      <span id="cron-readable">Every Monday at 10:00</span>
      <span id="next-run">Next: 07.09.2026, 10:00:00</span>
      <span id="technical-kind">cron</span>
      <span id="revision">Revision 1 · updated 5 сент., 3:16</span>`;
    window.__paperclipRu.resweep();
    const company = document.createElement('span');
    company.id = 'company';
    company.setAttribute('title', 'Dashboard');
    company.className = 'truncate';
    company.textContent = 'Dashboard';
    document.body.appendChild(company);
    const action = document.createElement('button');
    action.id = 'action';
    action.setAttribute('aria-label', 'Save');
    document.body.appendChild(action);
  });
  for (const [id, text] of Object.entries({ task: 'Dashboard', agent: 'Settings', 'activity-name': 'Settings' })) assert.equal(await page.locator(`#${id}`).innerText(), text);
  for (const id of ['status', 'time', 'role', 'open', 'actor', 'event', 'revision']) assert.doesNotMatch(await page.locator(`#${id}`).innerText(), /[A-Za-z]{2}/, id);
  for (const id of ['blocked', 'change', 'reason', 'decisions']) assert.doesNotMatch(await page.locator(`#${id}`).getAttribute('aria-label'), /[A-Za-z]{2}/, id);
  assert.equal(await page.locator('#decisions').getAttribute('aria-label'), 'Решения, 21 решение');
  assert.equal(await page.locator('#system-error').innerText(), 'Агент недоступен для запуска в текущем состоянии');
  assert.equal(await page.locator('#variables-hint').innerText(), 'Переменные автоматически определяются по шаблонам {{placeholders}} в заголовке и инструкциях. Имя переменной доступно только для чтения — для переименования измените шаблон.');
  assert.equal(await page.locator('#filter-any').innerText(), 'Любой');
  assert.equal(await page.locator('#trigger-count').innerText(), '1 триггер');
  assert.equal(await page.locator('#execution-result').innerText(), 'Ошибка выполнения');
  assert.equal(await page.locator('#routine-status').innerText(), 'Ошибка');
  assert.equal(await page.locator('#routine-status-line').innerText(), '05.09.2026, 17:26:30 · ошибка');
  assert.equal(await page.locator('#last-run').getAttribute('aria-label'), 'Последний запуск: Ошибка. Открыть запуски.');
  assert.equal(await page.locator('#cron-readable').innerText(), 'По понедельникам в 10:00');
  assert.equal(await page.locator('#next-run').innerText(), 'Следующий запуск: 07.09.2026, 10:00:00');
  assert.equal(await page.locator('#technical-kind').innerText(), 'cron');
  assert.equal(await page.locator('#company').innerText(), 'Dashboard');
  assert.equal(await page.locator('#company').getAttribute('title'), 'Dashboard', 'Detached attributes wait for user-name context');
  assert.equal(await page.locator('#action').getAttribute('aria-label'), 'Сохранить', 'Detached UI attributes translate on attach');
  await page.locator('#company').evaluate(el => el.setAttribute('title', 'Settings'));
  assert.equal(await page.locator('#company').getAttribute('title'), 'Settings', 'Subsequent user title attributes stay unchanged');
  await page.locator('#task').evaluate(el => { el.textContent = 'Save'; });
  assert.equal(await page.locator('#task').innerText(), 'Save', 'Subsequent React-style writes preserve user text');
});
