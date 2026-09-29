import assert from 'node:assert/strict';

export const instructionBytes = '# Release QA instructions\r\n\r\n- Keep English content exactly.  \r\n- Preserve Dashboard and Save as model instructions.\r\n\r\n```json\r\n{"status":"in_progress","label":"Dashboard","count":21}\r\n```\r\n\r\n';
export function officialApi(baseUrl) {
  const url = new URL(baseUrl);
  assert.ok(['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Tests require a local, isolated Paperclip server');
  return async (route, method = 'GET', body) => {
    const response = await fetch(`${url.origin}/api${route}`, { method, headers: { 'content-type': 'application/json', origin: url.origin }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const json = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${JSON.stringify(json)}`);
    return json;
  };
}

// Call only against a disposable database: all names and content are fictitious.
export async function prepareOfficialInstance(baseUrl) {
  const settings = await officialApi(baseUrl)('/instance/settings/experimental');
  return officialApi(baseUrl)('/instance/settings/experimental', 'PATCH', {
    enableApps: true, enablePipelines: true, enableCases: true, enableStatusCards: true,
    enableDecisions: true, enableIsolatedWorkspaces: true, enableGoalsSidebarLink: true,
    ...(Object.hasOwn(settings, 'enableAgentChat') ? { enableAgentChat: true } : {}),
    ...(Object.hasOwn(settings, 'enableChatConnectors') ? { enableChatConnectors: true } : {}),
  });
}

export async function seedOfficial(baseUrl) {
  const api = officialApi(baseUrl);
  const settings = await prepareOfficialInstance(baseUrl);
  const company = await api('/companies', 'POST', { name: 'Демонстрация локализации', description: 'Фиктивные данные для проверки релиза', budgetMonthlyCents: 75000 });
  await api(`/companies/${company.id}`, 'PATCH', { requireBoardApprovalForNewAgents: false });
  const agent = await api(`/companies/${company.id}/agents`, 'POST', { name: 'Тестовый исследователь', role: 'general', title: 'Специалист', adapterType: 'codex_local', adapterConfig: {}, runtimeConfig: { heartbeat: { enabled: false } }, instructionsBundle: { entryFile: 'AGENTS.md', files: { 'AGENTS.md': instructionBytes } } });
  await api(`/agents/${agent.id}/pause`, 'POST', {});
  // Create the task-backed conversation without sending a message or waking
  // the paused agent. Empty-chat placeholder IDs are not real task resources.
  const conversation = settings.enableAgentChat
    ? await api(`/companies/${company.id}/chats/${agent.id}`, 'POST', {}) : null;
  const project = await api(`/companies/${company.id}/projects`, 'POST', { name: 'Проверка релиза', description: 'Фиктивный проект', status: 'in_progress', color: '#5b65d6' });
  const issues = [];
  for (const [i, status] of ['todo', 'in_progress', 'done', 'blocked'].entries()) {
    issues.push(await api(`/companies/${company.id}/issues`, 'POST', { title: ['Проверить обзор', 'Проверить редактор', 'Сверить контрольные суммы', 'Подготовить публикацию'][i], description: 'English user content: Dashboard, Save, Delete.\n\n```json\n{"status":"todo","title":"Dashboard"}\n```', status, priority: 'medium', projectId: project.id, assigneeAgentId: agent.id }));
  }
  for (const issue of [...issues, ...(conversation ? [conversation] : [])]) await api(`/issues/${issue.id}/documents/plan`, 'PUT', { title: 'План проверки', format: 'markdown', body: 'Фиктивный план для проверки интерфейса.\n' });
  const file = await api(`/agents/${agent.id}/instructions-bundle/file?path=AGENTS.md`);
  assert.deepEqual(Buffer.from(file.content), Buffer.from(instructionBytes), 'Seed must preserve every instruction byte');
  return { company, agent, project, issues, conversation };
}
