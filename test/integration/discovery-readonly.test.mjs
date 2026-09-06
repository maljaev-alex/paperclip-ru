import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeTempServer, createTestRoot, runTool } from "../helpers/copy-fixture.mjs";
import { candidateRoots, findServerPackage } from "../../tools/lib/paths.mjs";

test("explicit environment discovery does not start npm or create its cache", async (t) => {
  const server = makeTempServer({ label: "read-only-env", t });
  const root = createTestRoot("read-only-cache", t);
  const cache = path.join(root, "cache");
  assert.equal(findServerPackage({ env: { PAPERCLIP_SERVER_DIR: server }, execSync: () => { assert.fail("npm must not start"); } }).dir, server);
  for (const action of ["doctor", "status", "verify"]) {
    const result = await runTool([action, "--json"], { env: { ...process.env, PAPERCLIP_SERVER_DIR: server, npm_config_cache: cache } });
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).changed, false);
    assert.equal(fs.existsSync(cache), false, action);
  }
});

test("npm prefix autodiscovery is bounded and leaves no cache or debug log", (t) => {
  const root = createTestRoot("read-only-npm", t);
  const prefix = path.join(root, "prefix");
  const cache = path.join(root, "cache");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  const roots = candidateRoots({ env: { ...env, npm_config_prefix: prefix, npm_config_cache: cache } });
  const globalRoot = process.platform === "win32" ? path.join(prefix, "node_modules") : path.join(prefix, "lib", "node_modules");
  assert.ok(roots.includes(path.join(globalRoot, "@paperclipai", "server")), JSON.stringify(roots));
  assert.equal(fs.existsSync(cache), false);
  assert.equal(fs.existsSync(prefix), false);
});

test("custom npmrc prefix is read without running npm", (t) => {
  const root = createTestRoot("read-only-config", t);
  const config = path.join(root, "npmrc");
  const prefix = path.join(root, "custom-tools");
  fs.writeFileSync(config, 'prefix="${PAPERCLIP_TEST_PREFIX}"\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^npm_config_/i.test(key)));
  const roots = candidateRoots({ env: { ...env, NPM_CONFIG_USERCONFIG: config, PAPERCLIP_TEST_PREFIX: prefix } });
  const globalRoot = process.platform === "win32" ? path.join(prefix, "node_modules") : path.join(prefix, "lib", "node_modules");
  assert.ok(roots.includes(path.join(globalRoot, "@paperclipai", "server")));
  assert.equal(fs.existsSync(prefix), false);
});
