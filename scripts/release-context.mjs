import assert from 'node:assert/strict';

export function checkReleaseContext(env, pkg, head) {
  assert.equal(env.GITHUB_ACTIONS, 'true', 'Release requires GitHub Actions.');
  assert.equal(env.GITHUB_REPOSITORY, 'extraara/extraara-verifier', 'Unexpected repository.');
  assert.equal(env.RELEASE_REPOSITORY_VISIBILITY, 'public', 'Provenance requires a public repository.');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Release must be started manually.');
  assert.equal(env.GITHUB_REF, 'refs/heads/main', 'Release must use reviewed main.');
  assert.equal(env.GITHUB_REF_PROTECTED, 'true', 'Release requires protected main.');
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.equal(env.GITHUB_SHA, head, 'Checkout differs from the workflow revision.');
  assert.equal(pkg.name, '@extraara/verifier');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'This workflow stages stable versions only.');
  assert.equal(env.EXPECTED_VERSION, pkg.version, 'Requested version differs from package.json.');
  assert.equal(pkg.repository?.url, 'git+https://github.com/extraara/extraara-verifier.git');
  assert.equal(pkg.publishConfig?.provenance, true);
  assert.equal(pkg.publishConfig?.access, 'public');
  assert.equal(pkg.publishConfig?.registry, 'https://registry.npmjs.org/');
}
