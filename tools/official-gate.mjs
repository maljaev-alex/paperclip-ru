#!/usr/bin/env node
// Development-only gate. Creates a disposable runtime; requires a dedicated DB.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedOfficial } from '../test/helpers/official-seed.mjs';
import { treeInventory } from './lib/tree-snapshot.mjs';
import { restoreOfficialUi } from './lib/official-gate-cleanup.mjs';

const project = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const databaseUrl = process.env.PAPERCLIP_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error('Set PAPERCLIP_TEST_DATABASE_URL to an empty disposable PostgreSQL database');
const database = new URL(databaseUrl);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)) throw new Error('The official gate requires a local disposable database');
const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'paperclip-ru-official-gate-'));
const output = path.resolve(process.env.PAPERCLIP_TEST_OUTPUT || path.join(project, 'test-results/official'));
fs.mkdirSync(output, { recursive: true });
let runtime;
let server;
let before;
let accepted;
let activeCli = path.join(project, 'tools/paperclip-ru.mjs');
const log = fs.openSync(path.join(output, 'server.log'), 'w');
const execute = (program, args, { cwd = project, env = process.env, label = 'command' } = {}) => new Promise((resolve, reject) => {
  const outputFile = path.join(output, `${label}.log`);
  const out = fs.openSync(outputFile, 'w');
  const child = spawn(program, args, { cwd, env, windowsHide: true, stdio: ['ignore', out, out] });
  const timeout = setTimeout(() => child.kill(), 20 * 60 * 1000);
  child.on('error', reject);
  child.on('close', code => {
    clearTimeout(timeout);
    fs.closeSync(out);
    if (code === 0) return resolve();
    const tail = fs.readFileSync(outputFile, 'utf8').split(/\r?\n/).slice(-80).join('\n').trim();
    reject(new Error(`${label} failed (${code}); see test output${tail ? `\n\nLast ${label} log lines:\n${tail}` : ''}`));
  });
});
try {
  const version = process.env.PAPERCLIP_TEST_VERSION || JSON.parse(fs.readFileSync(path.join(project, 'data/compatibility.json'))).currentStable;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Official gate requires an explicit stable version');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ private: true, dependencies: { '@paperclipai/server': version } }));
  const npmEnv = { ...process.env };
  // npm run exports project-only configuration such as allow-scripts. The
  // disposable upstream package must get its own project installation context.
  for (const key of Object.keys(npmEnv)) if (/^npm_config_/i.test(key)) delete npmEnv[key];
  if (process.platform === 'win32') await execute(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm install --ignore-scripts --no-audit --no-fund'], { cwd: root, env: npmEnv, label: 'runtime-install' });
  else await execute('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, env: npmEnv, label: 'runtime-install' });
  server = path.join(root, 'node_modules/@paperclipai/server');
  before = treeInventory(path.join(server, 'ui-dist'));
  if (process.env.PAPERCLIP_RU_DIST_DIR) {
    const dest = path.join(root, 'tool');
    await execute(process.execPath, [activeCli, 'install', '--json', '--source-dir', path.resolve(process.env.PAPERCLIP_RU_DIST_DIR), '--install-dir', dest, '--server-dir', server], { label: 'artifact-install' });
    activeCli = path.join(dest, 'tools/paperclip-ru.mjs');
  }
  // The optional panel module changes what the browser tests may assert, so the
  // gate runs it explicitly instead of only ever exercising the default mode.
  const panelResize = /^(1|true)$/i.test(process.env.PAPERCLIP_RU_PANEL_RESIZE || '');
  const applyFlags = panelResize ? ['--with-panel-resize'] : [];
  const expectedFeatures = panelResize ? ['translation', 'panel-resize'] : ['translation'];
  for (const [label, args] of [['doctor', ['doctor']], ['apply-dry-run', ['apply', '--dry-run', ...applyFlags]], ['apply', ['apply', ...applyFlags]], ['verify', ['verify']], ['apply-idempotent', ['apply']]]) {
    await execute(process.execPath, [activeCli, ...args, '--json', '--server-dir', server], { label });
    const result = JSON.parse(fs.readFileSync(path.join(output, `${label}.log`), 'utf8'));
    if (!result.ok || result.error !== null || (label === 'apply-idempotent' && result.changed !== false)) throw new Error(`Invalid ${label} postconditions`);
    // apply-idempotent deliberately omits the flag: the recorded choice must
    // survive a flagless re-apply, which is the regression this gate guards.
    if (label !== 'doctor' && label !== 'verify' && result.details?.panelResize !== panelResize) {
      throw new Error(`${label} reported panelResize=${result.details?.panelResize}, expected ${panelResize}`);
    }
  }
  const appliedManifest = JSON.parse(fs.readFileSync(path.join(server, 'ui-dist/.paperclip-ru/manifest.json'), 'utf8'));
  if ([...appliedManifest.features].sort().join(',') !== [...expectedFeatures].sort().join(',')) {
    throw new Error(`manifest features ${JSON.stringify(appliedManifest.features)} != ${JSON.stringify(expectedFeatures)}`);
  }
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const home = path.join(root, 'home');
  const runtimeEnv = { ...process.env, PAPERCLIP_HOME: home, PAPERCLIP_CONFIG: path.join(home, 'config.json'), PAPERCLIP_INSTANCE_ID: 'release-qa', DATABASE_URL: databaseUrl,
    PAPERCLIP_TELEMETRY_DISABLED: '1', PAPERCLIP_MIGRATION_AUTO_APPLY: 'true', HEARTBEAT_SCHEDULER_ENABLED: 'false', HOST: '127.0.0.1', PORT: String(port), SERVE_UI: 'true' };
  runtime = spawn(process.execPath, [path.join(server, 'dist/index.js')], { cwd: root, env: runtimeEnv, windowsHide: true, stdio: ['ignore', log, log] });
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 120000;
  for (;;) {
    if (runtime.exitCode !== null) throw new Error('Official server exited during startup');
    try { if ((await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch { /* wait for startup */ }
    if (Date.now() > deadline) throw new Error('Official server startup timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const seed = await seedOfficial(baseUrl);
  const seedFile = path.join(root, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify(seed));
  await execute(process.execPath, [path.join(project, 'tools/run-node-tests.mjs'), 'test/official/*.test.mjs'], { label: 'browser', env: { ...process.env, PAPERCLIP_TEST_BASE_URL: baseUrl, PAPERCLIP_SERVER_DIR: server, PAPERCLIP_TEST_SEED: seedFile, PAPERCLIP_TEST_OUTPUT: output, PAPERCLIP_RU_PANEL_RESIZE: panelResize ? '1' : '' } });
  accepted = { ok: true, version, output, artifact: Boolean(process.env.PAPERCLIP_RU_DIST_DIR), panelResize, features: appliedManifest.features };
} finally {
  if (runtime && runtime.exitCode === null) {
    const stopped = new Promise(resolve => runtime.once('close', resolve));
    runtime.kill();
    await stopped;
  }
  fs.closeSync(log);
  if (server && before) {
    await restoreOfficialUi({ before, uiDist: path.join(server, 'ui-dist'), output,
      revert: () => execute(process.execPath, [activeCli, 'revert', '--json', '--server-dir', server], { label: 'revert' }) });
  }
  const relative = path.relative(fs.realpathSync(os.tmpdir()), root);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe gate cleanup path');
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(JSON.stringify({ ...accepted, byteIdenticalRevert: true }));
