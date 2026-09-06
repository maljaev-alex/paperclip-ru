import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE_SERVER } from '../helpers/copy-fixture.mjs';
import { fingerprintRecord, matchFingerprint } from '../../tools/lib/fingerprints.mjs';

test('synthetic fingerprint matches portable LF fixture bytes', () => {
  const record = fingerprintRecord('2026.831.1-synthetic');
  const uiDist = path.join(FIXTURE_SERVER, 'ui-dist');
  for (const file of Object.keys(record.files)) assert.equal(fs.readFileSync(path.join(uiDist, file), 'utf8').includes('\r'), false, `${file}: fixture hashes must be stable after Git checkout`);
  assert.equal(matchFingerprint({ record, uiDist, targets: Object.keys(record.files) }).ok, true);
});
