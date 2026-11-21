import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { checkReleaseContext } from './release-context.mjs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const head = '1'.repeat(40);
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'extraara/extraara-verifier',
  RELEASE_REPOSITORY_VISIBILITY: 'public',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/heads/main',
  GITHUB_REF_PROTECTED: 'true',
  GITHUB_SHA: head,
  EXPECTED_VERSION: pkg.version,
};

test('accepts the requested version from protected public main', () => {
  assert.doesNotThrow(() => checkReleaseContext(env, pkg, head));
});

for (const [field, value] of Object.entries({
  GITHUB_ACTIONS: undefined,
  GITHUB_REPOSITORY: 'someone/extraara-verifier',
  RELEASE_REPOSITORY_VISIBILITY: 'private',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/heads/EX-EP-feature/npm-provenance',
  GITHUB_REF_PROTECTED: 'false',
  GITHUB_SHA: '2'.repeat(40),
  EXPECTED_VERSION: '99.0.0',
})) {
  test(`rejects unexpected ${field}`, () => {
    assert.throws(() => checkReleaseContext({ ...env, [field]: value }, pkg, head));
  });
}

test('rejects a changed registry or disabled provenance', () => {
  for (const changes of [{ provenance: false }, { registry: 'https://example.com/' }]) {
    assert.throws(() => checkReleaseContext(env, { ...pkg, publishConfig: { ...pkg.publishConfig, ...changes } }, head));
  }
});
