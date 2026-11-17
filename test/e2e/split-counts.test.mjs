import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { loadDictionary } from '../../tools/lib/dictionary.mjs';
import { buildOverlay } from '../../tools/lib/overlay.mjs';
import { createTranslator } from '../../tools/lib/translate-runtime.mjs';

const expected = {"1":["1 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043d\u0430\u0432\u044b\u043a \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u043e\u0448\u0438\u0431\u043a\u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0438 \u0431\u0443\u0434\u0435\u0442 \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d.","1 \u043d\u043e\u0432\u044b\u0439 \u043d\u0430\u0432\u044b\u043a \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d","1 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f.","1 \u0444\u0430\u0439\u043b"],"2":["2 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445 \u043d\u0430\u0432\u044b\u043a\u0430 \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442 \u043e\u0448\u0438\u0431\u043a\u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0438 \u0431\u0443\u0434\u0443\u0442 \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u044b.","2 \u043d\u043e\u0432\u044b\u0445 \u043d\u0430\u0432\u044b\u043a\u0430 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b","2 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0445 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f \u043e\u0436\u0438\u0434\u0430\u044e\u0442 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f.","2 \u0444\u0430\u0439\u043b\u0430"],"5":["5 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0445 \u043d\u0430\u0432\u044b\u043a\u043e\u0432 \u0441\u043e\u0434\u0435\u0440\u0436\u0430\u0442 \u043e\u0448\u0438\u0431\u043a\u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0438 \u0431\u0443\u0434\u0443\u0442 \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d\u044b.","5 \u043d\u043e\u0432\u044b\u0445 \u043d\u0430\u0432\u044b\u043a\u043e\u0432 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b","5 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u044b\u0445 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0439 \u043e\u0436\u0438\u0434\u0430\u044e\u0442 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f.","5 \u0444\u0430\u0439\u043b\u043e\u0432"],"21":["21 \u0432\u044b\u0431\u0440\u0430\u043d\u043d\u044b\u0439 \u043d\u0430\u0432\u044b\u043a \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u043e\u0448\u0438\u0431\u043a\u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u0438 \u0431\u0443\u0434\u0435\u0442 \u043f\u0440\u043e\u043f\u0443\u0449\u0435\u043d.","21 \u043d\u043e\u0432\u044b\u0439 \u043d\u0430\u0432\u044b\u043a \u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d","21 \u0441\u043e\u0445\u0440\u0430\u043d\u0451\u043d\u043d\u043e\u0435 \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u0435 \u043e\u0436\u0438\u0434\u0430\u0435\u0442 \u0432\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u0438\u044f.","21 \u0444\u0430\u0439\u043b"]};

test('official split count sentences agree at 1, 2, 5 and 21 without replacing React nodes or user prose', async t => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route('http://127.0.0.1/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto('http://127.0.0.1/CMP/skills/sources/new');
  await page.addScriptTag({ content: buildOverlay(loadDictionary(), { toolVersion: 'test' }) });
  for (const count of [1, 2, 5, 21]) {
    await page.evaluate(count => {
      document.body.innerHTML = '<p id="selected" class="text-sm text-muted-foreground"></p><a id="new" class="text-xs underline" href="/CMP/skills/sources/qa"></a><div class="execution-blocker-notice" role="status"><p id="saved"></p></div><span id="plain"></span><div class="prose"><p id="user" class="text-sm text-muted-foreground"></p></div><h2 id="heading"></h2>';
      const parts = {
        selected: [String(count), ' selected ', count === 1 ? 'skill has' : 'skills have', ' validation errors and will be skipped.'],
        new: [String(count), ' new ', count === 1 ? 'skill' : 'skills', ' available'],
        saved: [String(count), ' saved ', count === 1 ? 'message is' : 'messages are', ' waiting for recovery.'],
        plain: [String(count), ' file', count === 1 ? '' : 's'],
      };
      window.qaCountNodes = {};
      for (const id of ['selected', 'new', 'saved', 'plain', 'user', 'heading']) {
        const el = document.getElementById(id);
        const values = parts[id] || parts.selected;
        for (const [index, value] of values.entries()) {
          if (index) el.appendChild(document.createComment('React split'));
          el.appendChild(document.createTextNode(value));
        }
        window.qaCountNodes[id] = Array.from(el.childNodes);
      }
      window.__paperclipRu.resweep();
    }, count);
    for (const [index, id] of ['selected', 'new', 'saved', 'plain'].entries()) {
      assert.equal(await page.locator('#' + id).innerText(), expected[count][index], id + ': ' + count);
      assert.equal(await page.locator('#' + id).evaluate((el, key) => Array.from(el.childNodes).every((node, index) => node === window.qaCountNodes[key][index]), id), true, 'React text nodes must retain their identity');
    }
    assert.equal(await page.locator('#user').innerText(), count + ' selected ' + (count === 1 ? 'skill has' : 'skills have') + ' validation errors and will be skipped.', 'Identical text in user prose remains untouched');
    assert.equal(await page.locator('#heading').evaluate(el => el.childNodes[2].nodeValue.trim()), await page.evaluate(() => window.__paperclipRu.translate('selected')), 'A heading is not the scoped SkillSources sentence');
  }
  // React can update only the count when its English plural branch stays the
  // same. The complete known sentence must agree again without a remount.
  await page.evaluate(() => {
    for (const id of ['selected', 'new', 'saved']) document.getElementById(id).firstChild.nodeValue = '2';
  });
  for (const [index, id] of ['selected', 'new', 'saved'].entries()) assert.equal(await page.locator('#' + id).innerText(), expected[2][index]);
  await page.evaluate(() => {
    for (const id of ['selected', 'new', 'saved']) document.getElementById(id).firstChild.nodeValue = '5';
  });
  for (const [index, id] of ['selected', 'new', 'saved'].entries()) assert.equal(await page.locator('#' + id).innerText(), expected[5][index]);
});

test('budget and CSV counts follow in-place React updates and templates preserve interpolated values', async t => {
  const dictionary = loadDictionary();
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<p id="runs" class="text-sm text-destructive"></p><p id="usage" class="text-sm text-destructive"></p><div role="status" class="border-b"><span id="preview"></span></div><p id="invite"></p><button id="gateway"></button><p id="amount"></p><code id="command"></code>');
  await page.addScriptTag({ content: buildOverlay(dictionary, { toolVersion: 'test' }) });
  await page.evaluate(() => {
    for (const [id, values] of Object.entries({
      runs: ['1', ' completed runs await accounting.'],
      usage: ['1', ' usage events are unpriced. Known spend excludes their unknown cost.'],
      preview: ['Showing the first ', '1', ' rows and ', '2', ' columns. Download for the complete file.'],
    })) {
      const element = document.getElementById(id);
      for (const value of values) {
        element.appendChild(document.createComment('React split'));
        element.appendChild(document.createTextNode(value));
      }
    }
    window.budgetCountNodes = [document.querySelector('#runs').childNodes[1], document.querySelector('#runs').lastChild];
  });
  assert.equal(await page.locator('#runs').textContent(), '1 завершённый запуск ожидает учёта.');
  assert.equal(await page.locator('#usage').textContent(), '1 событие использования без оценки стоимости. Его стоимость не включена в известные расходы.');
  assert.equal(await page.locator('#preview').textContent(), 'Показано: 1 строка и 2 столбца. Скачайте полный файл.');

  await page.evaluate(() => {
    window.budgetCountNodes[0].nodeValue = '5';
    document.querySelector('#usage').childNodes[1].data = '21';
    document.querySelector('#preview').childNodes[3].nodeValue = '2';
    document.querySelector('#preview').childNodes[7].data = '5';
  });
  assert.equal(await page.locator('#runs').textContent(), '5 завершённых запусков ожидают учёта.');
  assert.equal(await page.locator('#usage').textContent(), '21 событие использования без оценки стоимости. Его стоимость не включена в известные расходы.');
  assert.equal(await page.locator('#preview').textContent(), 'Показано: 2 строки и 5 столбцов. Скачайте полный файл.');
  assert.equal(await page.locator('#runs').evaluate(el => el.childNodes[1] === window.budgetCountNodes[0] && el.lastChild === window.budgetCountNodes[1]), true);

  const company = 'Open  Build\u00a0Ops';
  const updatedCompany = 'Open\u00a0Build  Ops';
  const amount = '12\u202f345,67\u00a0$';
  await page.evaluate(({ company, updatedCompany, amount }) => {
    const invite = document.querySelector('#invite');
    const text = document.createTextNode('Bring an agent you already use into ' + company + '.');
    invite.appendChild(text);
    window.originalInviteNode = text;
    text.nodeValue = 'Bring an agent you already use into ' + updatedCompany + '.';
    document.querySelector('#gateway').setAttribute('aria-label', 'Turn ' + updatedCompany + ' off');
    document.querySelector('#amount').textContent = amount + ' used';
    document.querySelector('#command').textContent = 'Use ops/rollback & retry';
  }, { company, updatedCompany, amount });
  assert.equal(await page.locator('#invite').textContent(), 'Пригласите агента, которым уже пользуетесь, в компанию «' + updatedCompany + '».');
  assert.equal(await page.locator('#invite').evaluate(el => el.firstChild === window.originalInviteNode), true);
  assert.equal(await page.locator('#gateway').getAttribute('aria-label'), 'Выключить ' + updatedCompany);
  assert.equal(await page.locator('#amount').textContent(), 'Использовано: ' + amount);
  assert.equal(await page.locator('#command').textContent(), 'Use ops/rollback & retry');

  const { translate } = createTranslator(dictionary);
  assert.equal(translate('Bring an agent you already use into ' + company + '.'), 'Пригласите агента, которым уже пользуетесь, в компанию «' + company + '».');
  assert.equal(translate('Use\n ops/rollback & retry'), 'Использовать «ops/rollback» и повторить');
  assert.equal(translate('completed runs\n await accounting.'), 'завершённых запусков ожидают учёта.');
  assert.equal(translate('Bring an agent you already\n use into ' + company + '.'), 'Bring an agent you already\n use into ' + company + '.');
});
