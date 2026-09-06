import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createTestRoot, makeTempServer, treeHashes, runTool } from '../helpers/copy-fixture.mjs';
import { buildRelease } from '../../tools/lib/release-builder.mjs';
import { extractReleaseArchive } from '../../tools/lib/archive-read.mjs';
import { installRuntimeDeps } from '../../tools/lib/lifecycle.mjs';

const shells = process.platform === 'win32'
  ? [{ name: 'PowerShell 5.1', exe: 'powershell', ext: 'ps1' }, { name: 'PowerShell 7', exe: process.env.PAPERCLIP_TEST_PWSH || 'pwsh', ext: 'ps1' }, { name: 'Git Bash', exe: 'C:/Program Files/Git/bin/bash.exe', ext: 'sh' }]
  : [{ name: 'POSIX Bash', exe: 'bash', ext: 'sh' }];

for (const shell of shells) test(`${shell.name}: verified archive bootstrap install/update/uninstall`, async (t) => {
  const root = createTestRoot('bootstrap-lifecycle', t);
  const dist = process.env.PAPERCLIP_RU_DIST_DIR || buildRelease({ testBuild: true, outDir: path.join(root, 'dist') }).dist;
  const bootstrap = path.join(root, 'bootstrap');
  const asset = `paperclip-ru-1.0.0.${shell.ext === 'ps1' ? 'zip' : 'tar.gz'}`;
  extractReleaseArchive(path.join(dist, asset), bootstrap);
  const tool = path.join(bootstrap, 'paperclip-ru');
  installRuntimeDeps(tool);
  const server = makeTempServer({ label: 'bootstrap-server', t });
  fs.writeFileSync(path.join(server, 'test-user-data.txt'), 'Preserve test company data\n');
  const original = treeHashes(server);
  const dest = path.join(root, 'installed');
  const run = (action, dry = false) => new Promise((resolve, reject) => {
    const values = { 'install-dir': dest, 'server-dir': server, ...(action === 'uninstall' ? {} : { 'source-dir': dist, version: '1.0.0' }) };
    const option = value => shell.ext === 'ps1' ? '-' + value.split('-').map(p => p[0].toUpperCase() + p.slice(1)).join('') : '--' + value;
    const args = [option('json'), option('non-interactive'), ...(dry ? [option('dry-run')] : []), ...Object.entries(values).flatMap(([k, v]) => [option(k), v])];
    const file = path.join(tool, 'scripts', `${action}.${shell.ext}`);
    const child = spawn(shell.exe, [...(shell.ext === 'ps1' ? ['-NoProfile', '-File'] : []), file, ...args], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr += b; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${shell.name} ${action} timed out`)); }, 300000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timeout);
      try {
        assert.equal(code, 0, stderr + stdout);
        const json = JSON.parse(stdout);
        assert.equal(json.ok, true); assert.equal(json.error, null); assert.equal(json.action, action);
        resolve(json);
      } catch (error) { reject(error); }
    });
  });
  assert.equal((await run('install', true)).changed, false);
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual(treeHashes(server), original, 'dry-run must be read-only');
  assert.equal((await run('install')).stateAfter, 'applied/current');
  const enable = await runTool(['apply', '--with-panel-resize', '--json', '--server-dir', server], {
    tool: path.join(dest, 'tools', 'paperclip-ru.mjs'), cwd: dest,
  });
  assert.equal(enable.code, 0, enable.stderr + enable.stdout);
  assert.equal(JSON.parse(enable.stdout).details.panelResize, true);
  assert.equal((await run('update')).stateAfter, 'applied/current');
  const updatedManifest = JSON.parse(fs.readFileSync(path.join(server, 'ui-dist', '.paperclip-ru', 'manifest.json'), 'utf8'));
  assert.ok(updatedManifest.features.includes('panel-resize'), 'Wrapper update must keep an already enabled panel resize');
  await run('uninstall');
  assert.equal(fs.existsSync(dest), false);
  assert.deepEqual(treeHashes(server), original, 'uninstall must restore the bundle and preserve other data');
});
