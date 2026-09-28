import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { officialApi, seedOfficial } from '../helpers/official-seed.mjs';

test('official user names equal to dictionary keys stay unchanged', async () => {
  const baseUrl = process.env.PAPERCLIP_TEST_BASE_URL;
  assert.ok(baseUrl, 'An explicit disposable official server is required');
  const api = officialApi(baseUrl);
  const seed = process.env.PAPERCLIP_TEST_SEED ? JSON.parse(fs.readFileSync(process.env.PAPERCLIP_TEST_SEED)) : await seedOfficial(baseUrl);
  const issue = seed.issues[0];
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    await api(`/issues/${issue.id}`, 'PATCH', { title: 'Dashboard' });
    await api(`/agents/${seed.agent.id}`, 'PATCH', { name: 'Settings' });
    await api(`/companies/${seed.company.id}`, 'PATCH', { name: 'Dashboard' });
    await api(`/projects/${seed.project.id}`, 'PATCH', { name: 'Settings' });
    const page = await browser.newPage();
    const prefix = seed.company.issuePrefix;
    await page.goto(`${baseUrl}/${prefix}/issues`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('.line-clamp-2.text-sm').allTextContents()).includes('Dashboard'), 'Issue list user title');
    const sidebarAgents = page.locator(`a[href*="/${prefix}/agents/"] .truncate`);
    if (await sidebarAgents.count()) assert.ok((await sidebarAgents.allTextContents()).includes('Settings'), 'Agent sidebar user name');
    assert.match(await page.locator(`a[href="/${prefix}/dashboard"]`).innerText(), /Обзор/, 'Navigation chrome still translates');
    const switcher = page.locator('button[aria-label*="Dashboard"]').first();
    const switcherLabel = await switcher.getAttribute('aria-label');
    assert.match(switcherLabel || '', /[А-Яа-яЁё].*Dashboard|Dashboard.*[А-Яа-яЁё]/, 'Company switcher chrome translates without changing the company name');
    assert.match(await switcher.innerText(), /Dashboard/, 'Company name');
    const companyTooltip = switcher.locator('[title]').filter({ hasText: 'Dashboard' });
    if (await companyTooltip.count()) assert.equal(await companyTooltip.first().getAttribute('title'), 'Dashboard', 'Company tooltip');
    await switcher.click();
    assert.ok((await page.locator('[role="menuitem"] > .truncate, [role="menuitem"] .truncate[class*="organization-popover-name-line-height"]').allTextContents()).includes('Dashboard'), 'Company switcher menu name');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Доска', exact: true }).click();
    const boardCards = page.locator('main [role="button"].cursor-grab');
    await boardCards.filter({ hasText: 'Dashboard' }).first().waitFor({ state: 'visible' });
    await boardCards.filter({ hasText: 'Settings' }).first().waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');
    const boardCardText = await boardCards.allTextContents();
    assert.ok(boardCardText.some(text => text.includes('Dashboard')), 'Board card user title');
    assert.ok(boardCardText.some(text => text.includes('Settings')), 'Board card assignee name');
    const assigneeTooltips = boardCards.locator('span.inline-flex[title]:has([data-slot="avatar"])');
    if (await assigneeTooltips.count()) assert.ok((await assigneeTooltips.evaluateAll(elements => elements.map(el => el.title))).every(title => title === 'Settings'), 'Board assignee tooltips preserve user names');
    await page.goto(`${baseUrl}/${prefix}/agents/all`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('main').innerText()).includes('Settings'), 'Agent list user name');
    await page.goto(`${baseUrl}/${prefix}/issues/${issue.identifier}`, { waitUntil: 'networkidle' });
    const issueHeader = page.locator('[data-testid="issue-detail-header"] h2');
    if (await issueHeader.count()) assert.equal(await issueHeader.innerText(), 'Dashboard');
    else assert.ok((await page.locator('main').innerText()).includes('Dashboard'), 'Issue detail user title');
    const issueBreadcrumb = page.locator('[data-slot="breadcrumb-page"] .truncate');
    if (await issueBreadcrumb.count()) assert.ok((await issueBreadcrumb.allTextContents()).every(text => text.trim() === 'Dashboard'), 'Every responsive issue breadcrumb keeps its user title');
    const composerAssignee = page.locator('[data-testid="task-chat-composer-assignee"] .truncate');
    if (await composerAssignee.count()) assert.equal(await composerAssignee.innerText(), 'Settings');
    else assert.ok((await page.locator('main').innerText()).includes('Settings'), 'Issue detail assignee name');
    await page.goto(`${baseUrl}/${prefix}/agents/${seed.agent.id}/dashboard`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('h1,h2').allTextContents()).includes('Settings'), 'Agent heading user name');
    if (new URL(page.url()).pathname.endsWith('/overview')) {
      await page.goto(`${baseUrl}/${prefix}/agents/${seed.agent.id}/instructions`, { waitUntil: 'networkidle' });
      // Renaming the agent may replace its UUID URL with a readable URL key.
      const agentCrumbs = page.locator(`a.truncate[href^="/${prefix}/agents/"][href$="/overview"]`);
      await agentCrumbs.first().waitFor();
      assert.ok((await agentCrumbs.allTextContents()).every(text => text.trim() === 'Settings'), 'Contextual agent breadcrumb user name');
      await page.goto(`${baseUrl}/${prefix}/chats/${seed.agent.id}`, { waitUntil: 'networkidle' });
      assert.ok((await page.locator('main').innerText()).includes('Settings'), 'Agent chat keeps the user name');
    }
    await page.goto(`${baseUrl}/${prefix}/projects`, { waitUntil: 'networkidle' });
    assert.ok((await page.locator('main').innerText()).includes('Settings'), 'Project list name');
    await page.goto(`${baseUrl}/${prefix}/projects/${seed.project.id}/issues`, { waitUntil: 'networkidle' });
    const projectHeading = page.locator('h2.text-xl.cursor-pointer');
    if (await projectHeading.count()) assert.equal(await projectHeading.innerText(), 'Settings', 'Project heading');
    else assert.ok((await page.locator('main').innerText()).includes('Settings'), 'Project heading');
    const projectBreadcrumb = page.locator('[data-slot="breadcrumb-page"]');
    if (await projectBreadcrumb.count()) assert.ok((await projectBreadcrumb.allTextContents()).every(text => text.trim() === 'Settings'), 'Project breadcrumb');
    assert.equal((await api(`/issues/${issue.id}`)).title, 'Dashboard');
    assert.equal((await api(`/agents/${seed.agent.id}`)).name, 'Settings');
    assert.equal((await api(`/companies/${seed.company.id}`)).name, 'Dashboard');
    assert.equal((await api(`/projects/${seed.project.id}`)).name, 'Settings');
  } finally {
    await api(`/issues/${issue.id}`, 'PATCH', { title: issue.title });
    await api(`/agents/${seed.agent.id}`, 'PATCH', { name: seed.agent.name });
    await api(`/companies/${seed.company.id}`, 'PATCH', { name: seed.company.name });
    await api(`/projects/${seed.project.id}`, 'PATCH', { name: seed.project.name });
    await browser.close();
  }
});
