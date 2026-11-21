import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  truncateSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'bin/extraara-verify.mjs');
const record = join(root, 'fixtures/synthetic-certificate.json');
const document = join(root, 'fixtures/synthetic-document.txt');
const key = JSON.parse(readFileSync(record)).keyID;
const run = (args) => {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: tmpdir(),
    encoding: 'utf8',
    timeout: 4000,
    maxBuffer: 2 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
};

test('CLI verifies from outside the package directory', () => {
  const result = run(['record', record, '--document', document, '--trusted-key', key, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.requestedChecksPassed, true);
  assert.equal(report.format, 'extraproof/1');
  assert.equal(report.documentBinding, 'matched');
  assert.equal(report.signerTrust, 'pinned-key');
});

test('CLI reports the actual ExtraProof format and a matching document', () => {
  const result = run([
    'record', join(root, 'fixtures/extraproof-certificate.json'),
    '--document', join(root, 'fixtures/extraproof-document.txt'), '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.format, 'extraproof/1');
  assert.equal(report.documentBinding, 'matched');
});

test('CLI pin mismatch changes both machine-readable success and exit status', () => {
  const result = run(['record', record, '--trusted-key', '0'.repeat(64), '--json']);
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.requestedChecksPassed, false);
  assert.equal(report.recordIntegrity, 'valid');
  assert.equal(report.signerTrust, 'unknown');
});

test('CLI reports unrequested document and trust checks explicitly', () => {
  const result = run(['record', record, '--json']);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.documentBinding, 'notChecked');
  assert.equal(report.signerTrust, 'unknown');
});

test('CLI rejects wrong document bytes and does not treat a PDF as a JSON certificate', () => {
  const directory = mkdtempSync(join(tmpdir(), 'extraara-cli-'));
  try {
    const file = join(directory, 'input');
    writeFileSync(file, '%PDF-1.7\n');
    assert.equal(run(['record', record, '--document', file]).status, 1);
    assert.equal(run(['record', file]).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI validates all package references and explicit trust', () => {
  const directory = join(root, 'fixtures/package');
  const args = [
    'package',
    join(directory, 'manifest.json'),
    join(directory, 'record.json'),
    '--document',
    join(directory, 'document.txt'),
    '--json',
  ];
  const result = run(args);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).packageIntegrity, 'valid');
  const denied = run([...args, '--trusted-key', '0'.repeat(64)]);
  assert.equal(denied.status, 2);
  assert.equal(JSON.parse(denied.stdout).requestedChecksPassed, false);
});

test('CLI rejects malformed arguments without running verification', () => {
  for (const args of [
    [],
    ['record'],
    ['record', record, '--json', '--json'],
    ['record', record, '--trusted-key', 'A'.repeat(64)],
    ['record', record, '--network'],
    ['record', record, '--trusted-key', key, '--trusted-key', key],
  ]) {
    assert.equal(run(args).status, 64);
  }
  assert.equal(run(['--help']).status, 0);
});

test('CLI rejects directories, missing files and oversized sparse inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'extraara-files-'));
  try {
    const oversized = join(directory, 'oversized');
    writeFileSync(oversized, '');
    truncateSync(oversized, 16 * 1024 * 1024 + 1);
    for (const file of [directory, oversized, join(directory, 'missing')]) {
      assert.equal(run(['record', file]).status, 66);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'CLI rejects symlinks and named pipes without blocking',
  { skip: process.platform === 'win32' },
  () => {
    const directory = mkdtempSync(join(tmpdir(), 'extraara-special-'));
    try {
      const link = join(directory, 'link');
      symlinkSync(record, link);
      assert.equal(run(['record', link]).status, 66);
      const pipe = join(directory, 'pipe');
      assert.equal(spawnSync('mkfifo', [pipe]).status, 0);
      assert.equal(run(['record', pipe]).status, 66);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
