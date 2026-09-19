// すべてのテストを順に実行する。npm test
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const steps = [
  ['smoke.cjs', 'index.html'],
  ['mobile.cjs'],
  ['profile.cjs', 'index.html'],
  ['matrix.cjs', 'index.html'],
  ['parity.cjs', 'index.html'],
];
let failed = 0;
for (const [script, ...args] of steps) {
  console.log(`\n=== ${script} ${args.join(' ')} ===`);
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test(s) failed` : '\nall passed');
process.exitCode = failed ? 1 : 0;
