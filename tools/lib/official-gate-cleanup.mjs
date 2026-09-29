import fs from 'node:fs';
import path from 'node:path';
import { compareTree } from './tree-snapshot.mjs';

// A rejected doctor/dry-run has not patched the bundle. Calling revert on
// that unsupported version would hide the original failure during cleanup.
export async function restoreOfficialUi({ before, uiDist, output, revert }) {
  let check = compareTree(before, uiDist, { mtimes: false });
  if (!check.ok) {
    await revert();
    check = compareTree(before, uiDist, { mtimes: false });
  }
  fs.writeFileSync(path.join(output, 'revert-inventory.json'), JSON.stringify(check));
  if (!check.ok) throw new Error('Official bundle revert differs from the original inventory');
  return check;
}
