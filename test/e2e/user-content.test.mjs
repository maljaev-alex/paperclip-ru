import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadDictionary } from '../../tools/lib/dictionary.mjs';
import { buildOverlay, patchActivityActorFallbacks } from '../../tools/lib/overlay.mjs';
import { applyDictionary, extractOccurrences } from '../../tools/lib/strings.mjs';
import { activityRowSource } from '../helpers/activity-row-fixture.mjs';

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

test('legacy connection choice names and aria stay data while the source UI option and descriptions translate', async t => {
  const dictionary = loadDictionary();
  // AiConnectionPicker passes this literal and API names into the same slot.
  const source = 'window.qaChoices = (accounts, personalDefault) => [{id:"responsible_user",name:"Responsible user\u2019s connection",personalName:personalDefault?.name ?? "Not connected"},...accounts.map(account=>({id:account.id,name:account.name}))];';
  const patched = applyDictionary(source, extractOccurrences(source), dictionary.exact, { skipStatic: dictionary.noStatic });
  assert.equal(patched.replacements, 2, 'The responsible-user UI option and absent-account fallback must translate at their source');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/CMP/apps/connect');
  await page.addScriptTag({ content: buildOverlay(dictionary, { toolVersion: 'test' }) });
  await page.addScriptTag({ content: patched.code });
  const names = ['Shared', 'Dashboard', 'Settings', 'Save', 'Responsible user\u2019s connection', 'Not connected'];
  for (const route of ['/CMP/apps/connect', '/CMP/agents/new', '/CMP/agents/test/configuration', '/CMP/agents/test/runtime']) {
    await page.evaluate(({ route, names }) => {
      history.replaceState({}, '', route);
      document.body.replaceChildren();
      const agent = route.includes('/agents/');
      const container = document.createElement(agent ? 'section' : 'div');
      if (agent) container.setAttribute('aria-label', 'AI connection');
      else container.setAttribute('data-testid', 'connection-existing-choice');
      const list = document.createElement('div');
      list.className = 'space-y-2';
      const accounts = names.map((name, i) => ({ id: `account-${i}`, name }));
      for (const choice of agent ? window.qaChoices(accounts, { name: 'Shared' }) : accounts) {
        const button = document.createElement('button');
        button.id = choice.id;
        button.type = 'button';
        button.className = 'flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60';
        button.setAttribute('aria-label', choice.name);
        button.innerHTML = '<span class="min-w-0"><span class="block font-medium text-foreground"></span><span class="mt-1 block text-xs text-muted-foreground"></span></span>';
        button.querySelector('.font-medium').textContent = choice.name;
        const description = button.querySelector('.text-muted-foreground');
        // The source emits separate React nodes for ownership and auth method.
        if (choice.id === 'responsible_user') {
          const personal = document.createElement('span');
          personal.id = 'personal-line';
          personal.className = 'block';
          personal.appendChild(document.createTextNode('For you: '));
          personal.appendChild(document.createTextNode(choice.personalName));
          description.appendChild(personal);
        } else {
          const captions = agent ? ['Company shared \u00b7 ', 'Subscription'] : ['Provider account available'];
          for (const caption of captions) description.appendChild(document.createTextNode(caption));
        }
        list.appendChild(button);
      }
      container.appendChild(list);
      document.body.appendChild(container);
      const chrome = document.createElement('div');
      chrome.innerHTML = '<span id="other-name-shape" class="block font-medium text-foreground">Shared</span><button id="choice-action" aria-label="Save">Save</button>';
      document.body.appendChild(chrome);
      window.__paperclipRu.resweep();
    }, { route, names });
    for (const [i, name] of names.entries()) {
      const row = page.locator(`#account-${i}`);
      assert.equal(await row.locator('.font-medium').innerText(), name, `${route}: name ${name}`);
      assert.equal(await row.getAttribute('aria-label'), name, `${route}: aria ${name}`);
    }
    const descriptions = await page.locator('button[id^="account-"] > span.min-w-0 > .text-muted-foreground').allTextContents();
    assert.ok(descriptions.length > 0);
    for (const description of descriptions) assert.equal(description.replace(/\s+/g, ' '), route.includes('/agents/')
      ? '\u041e\u0431\u0449\u0435\u0435 \u0434\u043b\u044f \u043a\u043e\u043c\u043f\u0430\u043d\u0438\u0438 \u00b7 \u041f\u043e\u0434\u043f\u0438\u0441\u043a\u0430'
      : '\u0423\u0447\u0451\u0442\u043d\u0430\u044f \u0437\u0430\u043f\u0438\u0441\u044c \u043f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430');
    if (route.includes('/agents/')) {
      const expected = '\u041f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f';
      assert.equal(await page.locator('#responsible_user .font-medium').innerText(), expected);
      assert.equal(await page.locator('#responsible_user').getAttribute('aria-label'), expected);
      for (const name of [...names, null]) {
        await page.locator('#personal-line').evaluate((el, name) => {
          el.lastChild.nodeValue = window.qaChoices([], name === null ? undefined : { name })[0].personalName;
        }, name);
        assert.equal(await page.locator('#personal-line').evaluate(el => el.lastChild.nodeValue), name ?? '\u041d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u043e');
        assert.equal(await page.locator('#personal-line').evaluate(el => el.firstChild.nodeValue.trim()), '\u0414\u043b\u044f \u0432\u0430\u0441:');
      }
    }
    assert.equal(await page.locator('#other-name-shape').innerText(), '\u041e\u0431\u0449\u0435\u0435');
    assert.equal(await page.locator('#choice-action').innerText(), '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');
    assert.equal(await page.locator('#choice-action').getAttribute('aria-label'), '\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c');
    await page.locator('#account-0').evaluate(el => {
      el.querySelector('.font-medium').firstChild.nodeValue = 'Save';
      el.setAttribute('aria-label', 'Save');
    });
    assert.equal(await page.locator('#account-0 .font-medium').innerText(), 'Save', 'A live account rename remains user data');
    assert.equal(await page.locator('#account-0').getAttribute('aria-label'), 'Save');
  }
  for (const [route, label] of [['/CMP/issues', 'AI connection'], ['/CMP/agents/test/configuration', 'General']]) {
    await page.evaluate(({ route, label }) => {
      const row = document.getElementById('account-1').cloneNode(true);
      row.querySelector('.font-medium').textContent = 'Dashboard';
      row.setAttribute('aria-label', 'Dashboard');
      history.replaceState({}, '', route);
      const section = document.createElement('section');
      section.setAttribute('aria-label', label);
      const list = document.createElement('div');
      list.className = 'space-y-2';
      list.appendChild(row);
      section.appendChild(list);
      document.body.replaceChildren();
      document.body.appendChild(section);
    }, { route, label });
    assert.equal(await page.locator('#account-1 .font-medium').innerText(), '\u041e\u0431\u0437\u043e\u0440', 'Unrelated routes and sections retain normal UI translation');
    assert.equal(await page.locator('#account-1').getAttribute('aria-label'), '\u041e\u0431\u0437\u043e\u0440');
  }
});

test('AI binding adoption preserves account names and statically translated responsible-user sentences', async t => {
  const dictionary = loadDictionary();
  const source = 'window.qaAdoption = (personal, account) => personal ? `Responsible user\u2019s default. For you: ${account?.name ?? "Not connected"}. Other users use their own default.` : account?.name;';
  const patched = applyDictionary(source, extractOccurrences(source), dictionary.exact, { skipStatic: dictionary.noStatic });
  assert.equal(patched.replacements, 3, 'Only the two UI template parts and absent-account fallback translate');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/CMP/agents/test/configuration');
  await page.addScriptTag({ content: buildOverlay(dictionary, { toolVersion: 'test' }) });
  await page.addScriptTag({ content: patched.code });
  for (const route of ['/CMP/agents/new', '/CMP/agents/test/configuration', '/CMP/agents/test/runtime']) {
    await page.evaluate(route => {
      history.replaceState({}, '', route);
      document.body.innerHTML = '<div data-slot="dialog-content"><div data-slot="dialog-header"><h2 data-slot="dialog-title">Adopt Connections for Board</h2></div><p id="adoption" class="text-sm"></p><p id="safety" class="text-xs text-muted-foreground">After adoption, missing credentials block execution. Previous authentication will not be used as a fallback.</p><div data-slot="dialog-footer"><button id="adopt-action">Use this binding when saved</button></div></div><p id="other-adoption" class="text-sm">Shared</p>';
      window.__paperclipRu.resweep();
    }, route);
    for (const name of ['Shared', 'Dashboard', 'Settings', 'Save', 'Responsible user\u2019s connection', 'Not connected']) {
      await page.locator('#adoption').evaluate((el, name) => { el.textContent = window.qaAdoption(false, { name }); }, name);
      assert.equal(await page.locator('#adoption').innerText(), name);
      await page.locator('#adoption').evaluate((el, name) => { el.textContent = window.qaAdoption(true, { name }); }, name);
      assert.equal(await page.locator('#adoption').innerText(), `\u041f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e \u0434\u043b\u044f \u043e\u0442\u0432\u0435\u0442\u0441\u0442\u0432\u0435\u043d\u043d\u043e\u0433\u043e \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u044f. \u0414\u043b\u044f \u0432\u0430\u0441: ${name}. \u0414\u0440\u0443\u0433\u0438\u0435 \u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u0442\u0435\u043b\u0438 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u044e\u0442 \u0441\u0432\u043e\u0438 \u043d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043f\u043e \u0443\u043c\u043e\u043b\u0447\u0430\u043d\u0438\u044e.`);
    }
    await page.locator('#adoption').evaluate(el => { el.textContent = window.qaAdoption(true, undefined); });
    assert.match(await page.locator('#adoption').innerText(), /\u041d\u0435 \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u043e/);
    assert.doesNotMatch(await page.locator('#adoption').innerText(), /[A-Za-z]/);
    assert.doesNotMatch(await page.locator('#safety').innerText(), /[A-Za-z]/);
    assert.doesNotMatch(await page.locator('#adopt-action').innerText(), /[A-Za-z]/);
    assert.equal(await page.locator('#other-adoption').innerText(), '\u041e\u0431\u0449\u0435\u0435');
  }
});

test('connection detail heading preserves the customized app name beside its translated rename control', async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/CMP/apps/account-id/permissions');
  await page.addScriptTag({ content: buildOverlay(loadDictionary(), { toolVersion: 'test' }) });
  await page.evaluate(() => {
    document.body.innerHTML = '<header><div class="flex items-center gap-3"><div class="min-w-0"><div class="flex items-center gap-1.5"><h1 id="app-name" class="truncate text-xl font-bold">Shared</h1><button id="rename" aria-label="Rename app"></button></div><div class="mt-2 flex flex-wrap items-center gap-2"><span id="app-status">Paused</span></div></div></div></header><h1 id="other-app-heading" class="truncate text-xl font-bold">Settings</h1>';
    window.__paperclipRu.resweep();
  });
  for (const name of ['Shared', 'Dashboard', 'Settings', 'Save']) {
    await page.locator('#app-name').evaluate((el, name) => { el.textContent = name; }, name);
    assert.equal(await page.locator('#app-name').innerText(), name);
  }
  assert.equal(await page.locator('#rename').getAttribute('aria-label'), '\u041f\u0435\u0440\u0435\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u0442\u044c \u043f\u0440\u0438\u043b\u043e\u0436\u0435\u043d\u0438\u0435');
  assert.equal(await page.locator('#app-status').innerText(), '\u041d\u0430 \u043f\u0430\u0443\u0437\u0435');
  assert.equal(await page.locator('#other-app-heading').innerText(), '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438');
  await page.evaluate(() => {
    history.replaceState({}, '', '/CMP/issues');
    document.getElementById('app-name').textContent = 'Settings';
  });
  assert.equal(await page.locator('#app-name').innerText(), '\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438', 'The exact heading shape on an unrelated route still translates');
});

test('connection intent choices retain account names in identified inline and provider dialog containers', async t => {
  const dictionary = loadDictionary();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/CMP/issues/CMP-1');
  await page.addScriptTag({ content: buildOverlay(dictionary, { toolVersion: 'test' }) });
  const names = ['Shared', 'Dashboard', 'Settings', 'Save'];
  const cases = [
    { route: '/CMP/issues/CMP-1', kind: 'existing', host: 'dialog', protected: true },
    { route: '/CMP/chats/agent-id', kind: 'existing', host: 'inline', protected: true },
    { route: '/CMP/issues/CMP-1', kind: 'remote', host: 'dialog', protected: true },
    { route: '/CMP/chats/agent-id', kind: 'remote', host: 'dialog', protected: true },
    { route: '/CMP/issues/CMP-1', kind: 'remote', host: 'none', protected: false },
    { route: '/CMP/chats/agent-id', kind: 'other', host: 'dialog', protected: false },
  ];
  for (const scenario of cases) {
    await page.evaluate(({ scenario, names }) => {
      history.replaceState({}, '', scenario.route);
      document.body.replaceChildren();
      const host = document.createElement('div');
      if (scenario.host === 'dialog') host.setAttribute('data-slot', 'dialog-content');
      if (scenario.host === 'inline') host.setAttribute('data-testid', 'ai-connection-inline-repair');
      const setup = document.createElement('div');
      setup.className = scenario.kind === 'existing' ? 'max-w-5xl' : 'space-y-5';
      if (scenario.kind === 'existing') setup.setAttribute('data-testid', 'connection-existing-choice');
      const list = document.createElement('div');
      list.className = 'space-y-2';
      names.forEach((name, i) => {
        const button = document.createElement('button');
        button.id = `intent-account-${i}`;
        button.type = 'button';
        button.className = 'flex w-full items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60';
        button.setAttribute('aria-label', name);
        button.innerHTML = '<span class="min-w-0"><span class="block font-medium text-foreground"></span><span class="mt-1 block text-xs text-muted-foreground"></span></span>';
        button.querySelector('.font-medium').textContent = name;
        button.querySelector('.text-muted-foreground').textContent = scenario.kind === 'remote' ? 'Provider account available' : 'Ready to use';
        list.appendChild(button);
      });
      setup.appendChild(list);
      const action = document.createElement('button');
      action.id = 'intent-action';
      action.textContent = 'Cancel';
      setup.appendChild(action);
      host.appendChild(setup);
      document.body.appendChild(host);
      window.__paperclipRu.resweep();
    }, { scenario, names });
    for (const [i, name] of names.entries()) {
      const expected = scenario.protected ? name : dictionary.exact.get(name);
      const row = page.locator(`#intent-account-${i}`);
      assert.equal(await row.locator('.font-medium').innerText(), expected, `${scenario.route} ${scenario.kind}/${scenario.host}: ${name}`);
      assert.equal(await row.getAttribute('aria-label'), expected);
      assert.equal(await row.locator('.text-muted-foreground').innerText(), dictionary.exact.get(scenario.kind === 'remote' ? 'Provider account available' : 'Ready to use'));
    }
    assert.equal(await page.locator('#intent-action').innerText(), dictionary.exact.get('Cancel'));
    if (scenario.protected) {
      await page.locator('#intent-account-0').evaluate(el => {
        el.querySelector('.font-medium').textContent = 'Settings';
        el.setAttribute('aria-label', 'Settings');
      });
      assert.equal(await page.locator('#intent-account-0 .font-medium').innerText(), 'Settings');
      assert.equal(await page.locator('#intent-account-0').getAttribute('aria-label'), 'Settings');
    }
  }
});

test('activity actor names remain data while source fallbacks and adjacent verbs translate', async t => {
  const dictionary = loadDictionary();
  const actor = patchActivityActorFallbacks(activityRowSource, dictionary.exact);
  assert.equal(actor.patched, true);
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addScriptTag({ content: buildOverlay(dictionary, { toolVersion: 'test', activityActorNamesPatched: actor.patched }) });
  await page.addScriptTag({ content: actor.code });
  const cases = ['Dashboard', 'Board', 'System', 'Unknown', 'mcp connection revoked'].flatMap(name => [
    { event: { actorType: 'agent' }, agent: { name }, expected: name },
    { event: { actorType: 'user' }, user: { label: name }, expected: name },
  ]);
  for (const [type, key] of [['system', 'System'], ['user', 'Board'], ['other', 'Unknown']]) cases.push({ event: { actorType: type }, expected: dictionary.exact.get(key) });
  for (const entry of cases) {
    await page.evaluate(entry => {
      const data = window.qaActor(entry.event, entry.agent, entry.user);
      const row = document.createElement('div');
      row.className = 'dashboard-list-row text-sm';
      const summary = document.createElement('span');
      summary.id = 'actor-line';
      summary.className = 'max-w-1/2 shrink-0 truncate';
      summary.setAttribute('title', data.span.title);
      window.qaDetachedActorTitle = summary.getAttribute('title');
      summary.innerHTML = '<span id="actor-name"></span> <span id="actor-verb" class="text-muted-foreground"></span>';
      summary.querySelector('#actor-name').textContent = data.name;
      summary.querySelector('#actor-verb').textContent = 'created';
      const paragraph = document.createElement('p');
      paragraph.appendChild(summary);
      row.appendChild(paragraph);
      document.body.replaceChildren();
      document.body.appendChild(row);
    }, entry);
    assert.equal(await page.evaluate(() => window.qaDetachedActorTitle), `${entry.expected} created`, 'Detached title stays raw until actor context exists');
    assert.equal(await page.locator('#actor-name').innerText(), entry.expected);
    assert.equal(await page.locator('#actor-verb').innerText(), '\u0441\u043e\u0437\u0434\u0430\u043d\u043e');
    assert.equal(await page.locator('#actor-line').getAttribute('title'), `${entry.expected} \u0441\u043e\u0437\u0434\u0430\u043d\u043e`);
    for (const [verb, translated] of [['read', '\u043f\u0440\u043e\u0447\u0438\u0442\u0430\u043b'], ['mcp connection revoked', '\u043e\u0442\u043e\u0437\u0432\u0430\u043b \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 MCP'], ['mcp connection authorized', '\u0430\u0432\u0442\u043e\u0440\u0438\u0437\u043e\u0432\u0430\u043b \u043f\u043e\u0434\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 MCP']]) {
      await page.locator('#actor-line').evaluate((el, { actor, verb }) => { el.setAttribute('title', `${actor} ${verb}`); }, { actor: entry.expected, verb });
      assert.equal(await page.locator('#actor-line').getAttribute('title'), `${entry.expected} ${translated}`);
    }
    await page.locator('#actor-name').evaluate(el => { el.textContent = 'Dashboard'; });
    assert.equal(await page.locator('#actor-name').innerText(), 'Dashboard');
    await page.locator('#actor-line').evaluate(el => el.setAttribute('title', 'Dashboard created'));
    assert.equal(await page.locator('#actor-line').getAttribute('title'), 'Dashboard \u0441\u043e\u0437\u0434\u0430\u043d\u043e');
  }
  await page.evaluate(() => {
    document.body.innerHTML = '<div><span class="max-w-1/2 shrink-0 truncate" title="Board created"><span id="ordinary-label">Board</span> <span class="text-muted-foreground">created</span></span></div>';
    window.__paperclipRu.resweep();
  });
  assert.equal(await page.locator('#ordinary-label').innerText(), dictionary.exact.get('Board'), 'Other spans keep normal UI translation');
});
