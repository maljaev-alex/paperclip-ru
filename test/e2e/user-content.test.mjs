import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadDictionary } from '../../tools/lib/dictionary.mjs';
import { buildOverlay } from '../../tools/lib/overlay.mjs';
import { applyDictionary, extractOccurrences } from '../../tools/lib/strings.mjs';

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
    document.body.insertAdjacentHTML('beforeend', `
      <a id="agent-breadcrumb" class="truncate" href="/CMP/agents/settings/overview">Settings</a>
      <a href="/CMP/agents/settings/channels"><span id="agent-channels" class="truncate">Channels</span></a>
      <a href="/CMP/agents/settings/overview"><h3 class="truncate">Settings</h3><p id="agent-role-caption" class="text-xs text-muted-foreground truncate">General - Специалист</p></a>
      <span id="assignee-tooltip" class="inline-flex" title="Settings"><span data-slot="avatar">SE</span><span class="truncate">Settings</span></span>
      <div role="menuitem"><span class="min-w-0 flex-1"><span id="company-nested" class="block truncate font-medium leading-(--organization-popover-name-line-height)">Dashboard</span><span class="block truncate text-muted-foreground">CMP</span></span></div>
      <div role="menuitem"><span id="company-action" class="min-w-0 flex-1 truncate">Create organization</span></div>
      <a href="/CMP/issues/CMP-1"><span class="max-w-1/2 shrink-0 truncate" id="activity-tooltip" title="Board created"><span>Board</span> <span class="text-muted-foreground">created</span></span></a>
      <div class="paperclip-markdown"><pre><code id="sample-code">Save Dashboard</code><button class="paperclip-markdown-codeblock-action" id="code-copy">Copy</button></pre></div>`);
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
  for (const [id, text] of Object.entries({ task: 'Dashboard', agent: 'Settings', 'activity-name': 'Settings', 'agent-breadcrumb': 'Settings', 'company-nested': 'Dashboard', 'sample-code': 'Save Dashboard' })) assert.equal(await page.locator(`#${id}`).innerText(), text);
  assert.equal(await page.locator('#company-action').innerText(), 'Создать организацию');
  assert.equal(await page.locator('#code-copy').innerText(), 'Копировать');
  assert.equal(await page.locator('#activity-tooltip').getAttribute('title'), 'Совет создал');
  assert.equal(await page.locator('#agent-role-caption').innerText(), 'Универсальный специалист — Специалист');
  assert.equal(await page.locator('#assignee-tooltip').getAttribute('title'), 'Settings');
  assert.equal(await page.locator('#agent-channels').innerText(), 'Каналы');
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

test('assistant client and organization names are protected only on their official data surfaces', async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/mcp-connect/qa-request');
  await page.addScriptTag({ content: buildOverlay(loadDictionary(), { toolVersion: 'test' }) });
  const cases = [
    { route: '/mcp-connect/qa-request', html: '<div data-slot="card"><h1><bdi id="name">Dashboard</bdi></h1><p id="company" class="break-words text-lg font-semibold">Settings</p><label><span id="radio-name" class="break-words font-medium">Dashboard</span></label><button id="chrome">Save</button></div><bdi id="other">Settings</bdi>', names: ['name', 'company', 'radio-name'] },
    { route: '/mcp-device', html: '<div data-slot="card"><h1><bdi id="name">Dashboard</bdi></h1><button id="chrome">Save</button></div><bdi id="other">Settings</bdi>', names: ['name'] },
    { route: '/assistant-connections', html: '<div data-slot="card"><h2 id="name" class="font-medium">Dashboard</h2><button id="chrome">Save</button></div><h2 id="other" class="font-medium">Settings</h2>', names: ['name'] },
    { route: '/CMP/apps/assistant-connection', html: '<div class="space-y-1"><p id="name" class="text-sm font-medium">Dashboard</p></div><div class="space-y-1"><p id="company" class="font-medium">Settings</p></div><button id="chrome">Save</button><p id="other" class="font-medium">Settings</p>', names: ['name', 'company'] },
    { route: '/CMP/apps', html: '<div data-app-slug="assistant-connection"><div class="border-t"><span id="name">Dashboard</span><span id="chrome" class="text-xs">Save</span></div><h2 id="other" class="font-medium">Settings</h2></div>', names: ['name'] },
  ];
  for (const sample of cases) {
    await page.evaluate(({ route, html }) => {
      history.replaceState({}, '', route);
      document.body.innerHTML = html;
      window.__paperclipRu.resweep();
    }, sample);
    for (const id of sample.names) assert.equal(await page.locator(`#${id}`).innerText(), id === 'company' ? 'Settings' : 'Dashboard', `${sample.route}: ${id}`);
    assert.equal(await page.locator('#chrome').innerText(), '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c', `${sample.route}: adjacent action`);
    assert.equal(await page.locator('#other').innerText(), '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438', `${sample.route}: ordinary heading or text`);
    await page.locator('#name').evaluate(el => { el.textContent = 'Delete'; });
    assert.equal(await page.locator('#name').innerText(), 'Delete', `${sample.route}: subsequent client-name updates`);
  }
  await page.evaluate(() => {
    history.replaceState({}, '', '/CMP/dashboard');
    document.body.innerHTML = '<div data-slot="card"><h1><bdi id="name">Dashboard</bdi></h1><h2 class="font-medium" id="other">Settings</h2></div>';
    window.__paperclipRu.resweep();
  });
  assert.equal(await page.locator('#name').innerText(), '\u041e\u0431\u0437\u043e\u0440', 'The consent selector must not suppress ordinary chrome on other routes');
  assert.equal(await page.locator('#other').innerText(), '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438');
});

test('MCP company text, radio labels and client values stay distinct from translated fallback chrome', async t => {
  const dictionary = loadDictionary();
  const source = 'window.qaAssistantName = function (clientName) { return clientName && !/^(assistant|mcp client)$/i.test(clientName) ? clientName : "your assistant"; };';
  const patched = applyDictionary(source, extractOccurrences(source), dictionary.exact, { skipStatic: dictionary.noStatic });
  assert.equal(patched.replacements, 1, 'The source-proven UI fallback must be translated statically');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/mcp-connect/qa-request');
  await page.addScriptTag({ content: buildOverlay(dictionary, { toolVersion: 'test' }) });
  await page.addScriptTag({ content: patched.code });
  await page.evaluate(() => {
    document.body.innerHTML = '<div data-slot="card"><h1><bdi id="client"></bdi></h1><label><input id="company-radio" type="radio" name="company" aria-label="Dashboard"><span class="break-words font-medium">Dashboard</span></label><button id="action">Save</button></div>';
    window.__paperclipRu.resweep();
  });
  for (const [name, expected] of [['assistant', '\u0432\u0430\u0448\u0435\u0433\u043e \u0430\u0441\u0441\u0438\u0441\u0442\u0435\u043d\u0442\u0430'], ['your assistant', 'your assistant'], ['Dashboard', 'Dashboard']]) {
    await page.locator('#client').evaluate((el, value) => { el.textContent = window.qaAssistantName(value); }, name);
    assert.equal(await page.locator('#client').innerText(), expected);
  }
  assert.equal(await page.locator('#company-radio').getAttribute('aria-label'), 'Dashboard');
  await page.locator('#company-radio').evaluate(el => el.setAttribute('aria-label', 'Settings'));
  assert.equal(await page.locator('#company-radio').getAttribute('aria-label'), 'Settings');
  assert.equal(await page.locator('#action').innerText(), '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');

  await page.evaluate(() => {
    history.replaceState({}, '', '/assistant-connections');
    document.body.innerHTML = '<div data-slot="card"><p id="company-line" class="text-sm text-muted-foreground">Organization: <!-- React split -->Dashboard</p></div>';
    window.__paperclipRu.resweep();
  });
  assert.equal(await page.locator('#company-line').innerText(), '\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f: Dashboard');
  await page.locator('#company-line').evaluate(el => { el.lastChild.nodeValue = 'Settings'; });
  assert.equal(await page.locator('#company-line').innerText(), '\u041e\u0440\u0433\u0430\u043d\u0438\u0437\u0430\u0446\u0438\u044f: Settings');

  await page.evaluate(() => {
    history.replaceState({}, '', '/CMP/apps/assistant-connection');
    document.body.innerHTML = '<details open><section><p class="text-sm">Choose <strong id="company">Dashboard</strong>, then click <strong id="action">Save</strong>.</p></section></details><section aria-labelledby="connected-assistants"><p id="empty" class="text-sm text-muted-foreground">No assistants connected to <!-- React split -->Dashboard<!-- React split --> yet.</p></section>';
    window.__paperclipRu.resweep();
  });
  assert.equal(await page.locator('#company').innerText(), 'Dashboard');
  assert.equal(await page.locator('#action').innerText(), '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');
  assert.equal(await page.locator('#empty').evaluate(el => el.childNodes[2].nodeValue), 'Dashboard');
});

test('AI connection pool account names remain data while ownership captions and actions translate', async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/QA/apps/connect?source=ai-router-6162');
  await page.addScriptTag({ content: buildOverlay(loadDictionary(), { toolVersion: 'test' }) });
  for (const name of ['Shared', 'Dashboard', 'Settings', 'Save']) {
    await page.evaluate(name => {
      document.body.innerHTML = '<div class="space-y-4"><ol aria-label="Connection order"><li><div class="min-w-0 flex-1"><p id="ordered" class="truncate text-sm font-medium"></p><p class="text-xs text-muted-foreground">Shared</p></div></li></ol><details open><summary>Advanced</summary><fieldset><div class="space-y-2"><p id="advanced" class="text-sm font-medium"></p><div><label>Model<input></label></div></div></fieldset></details></div><div class="max-h-80 overflow-y-auto"><label class="flex cursor-pointer"><button id="account-checkbox" role="checkbox" data-slot="checkbox"></button><span class="min-w-0 flex-1"><span id="picker" class="block truncate text-sm font-medium"></span><span id="ownership" class="block text-xs text-muted-foreground">Shared</span></span></label></div><button id="action">Save</button><p id="other" class="text-sm font-medium">Shared</p>';
      for (const id of ['ordered', 'advanced', 'picker']) document.getElementById(id).textContent = name;
      document.getElementById('account-checkbox').setAttribute('aria-label', name);
      window.__paperclipRu.resweep();
    }, name);
    for (const id of ['ordered', 'advanced', 'picker']) assert.equal(await page.locator(`#${id}`).innerText(), name, `${id}: ${name}`);
    assert.equal(await page.locator('#account-checkbox').getAttribute('aria-label'), name);
    for (const id of ['ownership', 'other']) assert.equal(await page.locator(`#${id}`).innerText(), '\u041e\u0431\u0449\u0435\u0435', `${id}: ownership chrome`);
    assert.equal(await page.locator('#action').innerText(), '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');
    await page.locator('#picker').evaluate(el => { el.textContent = 'Settings'; });
    assert.equal(await page.locator('#picker').innerText(), 'Settings', 'Live account renames stay user data');
  }
});
