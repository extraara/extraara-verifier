import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { checkReleaseContext } from './release-context.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
checkReleaseContext(process.env, pkg, head);
assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '', 'Release checkout must be clean.');
console.log(`Release context verified: ${pkg.name}@${pkg.version}, ${head}.`);
