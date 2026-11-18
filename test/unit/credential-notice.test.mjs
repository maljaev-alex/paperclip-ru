import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadDictionary } from '../../tools/lib/dictionary.mjs';
import { extractOccurrences, applyDictionary } from '../../tools/lib/strings.mjs';
import { patchCredentialAccessNotice } from '../../tools/lib/overlay.mjs';

// The arrays mirror the official TaskChatMarker JSX output on both stable builds.
const source = [
  'function notice(e){if(e.credentialAccess){const{agentName:a,credentialName:c,deniedUser:u,settingsHref:h}=e.credentialAccess;',
  'return(0,j.jsxs)("div",{role:"alert","data-testid":"task-chat-credential-access-notice",children:[',
  '(0,j.jsxs)("p",{className:"font-semibold text-destructive",children:[a," couldn’t start"]}),',
  '(0,j.jsxs)("p",{className:"break-words font-medium text-foreground",children:[a," is configured to use ",c||"an AI credential",", but ",u==="you"?"you don’t":`${u} doesn’t`," have access to that credential."]}),',
  '(0,j.jsxs)("p",{className:"text-muted-foreground",children:["Choose an AI connection ",u==="you"?"you can":`${u} can`," use, or ask an administrator to update ",a,"’s connection. Then try again."]}),',
  '(0,j.jsx)("a",{href:h,children:"Change AI connection"})]})}return e.collapsible?null:null}',
].join('');

test('credential errors preserve the account names, route and permission outcome', () => {
  const patched = patchCredentialAccessNotice(source);
  assert.notEqual(patched, source);
  assert.equal(patchCredentialAccessNotice(patched), patched);
  const dictionary = loadDictionary();
  const { code } = applyDictionary(patched, extractOccurrences(patched), dictionary.exact, { skipStatic: dictionary.noStatic });
  const render = (_type, props) => props;
  const context = { j: { jsx: render, jsxs: render } };
  vm.runInNewContext(code, context);
  const notice = (deniedUser, credentialName) => context.notice({ credentialAccess: {
    agentName: 'Dashboard', credentialName, deniedUser, settingsHref: '/QA/agents/id/runtime',
  } }).children;
  const [title, reason, action, link] = notice('Save  Owner', 'Settings $1');
  assert.equal(title.children.join(''), 'Не удалось запустить агента Dashboard');
  assert.equal(reason.children.join(''), 'Для агента «Dashboard» настроены учётные данные «Settings $1». У пользователя «Save  Owner» нет доступа к этим данным.');
  assert.equal(action.children.join(''), 'Выберите подключение к ИИ, доступное пользователю «Save  Owner», или попросите администратора изменить подключение агента «Dashboard». Затем повторите попытку.');
  for (const paragraph of [title, reason, action]) assert.equal(paragraph.translate, 'no');
  assert.equal(link.href, '/QA/agents/id/runtime');
  assert.equal(notice('you', '')[1].children.join(''), 'Для агента «Dashboard» настроены учётные данные ИИ. У вас нет доступа к этим данным.');
  const changed = source.replace(' is configured to use ', ' needs ');
  assert.equal(patchCredentialAccessNotice(changed), changed);
});
