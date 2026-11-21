import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmCLI = process.env.npm_execpath;
assert.ok(npmCLI, 'Run npm run check:package.');
const temporary = mkdtempSync(path.join(tmpdir(), 'verifier-package-'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json')));
assert.equal(pkg.name, '@extraara/verifier');
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);

function npm(args, cwd) {
  return execFileSync(process.execPath, [npmCLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(temporary, 'cache') },
    maxBuffer: 8 * 1024 * 1024,
  });
}

try {
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--offline', '--pack-destination', temporary], root));
  assert.equal(packed.name, pkg.name);
  assert.equal(packed.version, pkg.version);
  assert.equal(packed.filename, `extraara-verifier-${pkg.version}.tgz`);
  const filenames = packed.files.map((entry) => entry.path);
  for (const required of ['package.json', 'LICENSE', 'NOTICE', 'README.md', 'src/index.mjs', 'bin/extraara-verify.mjs', 'fixtures/extraproof-certificate.json', 'fixtures/extraproof-document.txt']) {
    assert.ok(filenames.includes(required), `Missing ${required}.`);
  }
  for (const name of filenames) {
    assert.ok(/^(src\/|bin\/|schemas\/|docs\/|fixtures\/|test\/|package\.json$|LICENSE$|NOTICE$|README\.md$|CHANGELOG\.md$|CONTRIBUTING\.md$|SECURITY\.md$)/.test(name), `Unexpected package file: ${name}`);
  }

  const consumer = path.join(temporary, 'consumer');
  mkdirSync(consumer);
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  npm(['install', path.join(temporary, packed.filename), '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], consumer);
  const installed = path.join(consumer, 'node_modules', '@extraara', 'verifier');
  for (const name of filenames) {
    assert.deepEqual(readFileSync(path.join(installed, name)), readFileSync(path.join(root, name)), `Packed bytes differ: ${name}`);
  }
  const installedPkg = JSON.parse(readFileSync(path.join(installed, 'package.json')));
  assert.equal(installedPkg.license, 'Apache-2.0');
  assert.equal(installedPkg.repository.url, 'git+https://github.com/extraara/extraara-verifier.git');
  assert.equal(installedPkg.bin['extraara-verify'], './bin/extraara-verify.mjs');
  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.equal(Object.keys(installedPkg[field] ?? {}).length, 0, 'Package must remain dependency-free.');
  }
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { verifyCertificate } from '@extraara/verifier';
    const base = './node_modules/@extraara/verifier/fixtures/';
    const record = readFileSync(base + 'extraproof-certificate.json');
    const document = readFileSync(base + 'extraproof-document.txt');
    const good = verifyCertificate(record, { fileBytes: document });
    assert.equal(good.isValid, true);
    assert.equal(good.signerTrusted, false);
    assert.equal(good.synthetic, true);
    const bad = verifyCertificate(record, { fileBytes: Buffer.concat([document, Buffer.from('!')]) });
    assert.equal(bad.isValid, false);
    assert.equal(bad.fileStatus, 'mismatched');
  `], { cwd: consumer, stdio: 'pipe' });
  const result = JSON.parse(execFileSync(process.execPath, ['bin/extraara-verify.mjs', 'record', 'fixtures/extraproof-certificate.json', '--document', 'fixtures/extraproof-document.txt', '--json'], { cwd: installed, encoding: 'utf8' }));
  assert.equal(result.format, 'extraproof/1');
  assert.equal(result.requestedChecksPassed, true);

  const output = path.join(root, '.release');
  mkdirSync(output, { recursive: true });
  copyFileSync(path.join(temporary, packed.filename), path.join(output, packed.filename));
  const sha256 = createHash('sha256').update(readFileSync(path.join(output, packed.filename))).digest('hex');
  writeFileSync(path.join(output, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, filename: packed.filename, integrity: packed.integrity, sha256, files: filenames }, null, 2) + '\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tarball=.release/${packed.filename}\n`);
  console.log(`Verified ${pkg.name}@${pkg.version}: ${filenames.length} packaged files, installed API and CLI, changed-document rejection. SHA-256 ${sha256}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
