# Releasing to npm

Package: `@extraara/verifier`

Source: `https://github.com/extraara/extraara-verifier`

The package contains the verifier, specifications and synthetic test data. The ExtraProof apps and production signing material are excluded. GitHub Actions submits each release to npm for approval.

## Setup

Before the first release:

1. Create an npm account with two-factor authentication and publishing rights for `@extraara`. Check that the scope is available and belongs to the right account or organization.
2. Review the repository files and history before making it public. Have the repository owner review and merge the release change in GitHub.
3. Protect `main`: require pull requests and tests, block direct and force pushes, and require the owner's review of each new revision.
4. Create a GitHub environment named `npm`. Restrict it to `main` and set the repository owner as reviewer.
5. Register the npm package and trusted publisher as described below. Keep credentials out of the repository.

The release job requires a public repository and protected `main`. The `repository.url` in `package.json` must match the GitHub source above exactly. Set up the trusted publisher when ready to release: an unused configuration expires after two days.

## Register the package

npm requires an existing package before it will accept a trusted publisher. A staged submission can register the name without releasing the verifier.

Log into npm. In a separate, empty temporary directory, create this `package.json`:

```json
{
  "name": "@extraara/verifier",
  "version": "0.0.0-bootstrap",
  "description": "Package registration pending the first verified release.",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/extraara/extraara-verifier.git"
  }
}
```

Using npm 11.15.0 or later, run from that directory:

```sh
npm stage publish --access public --provenance=false --tag bootstrap
```

npm creates a public `0.0.0-stage` placeholder and a pending bootstrap submission. Do not approve the bootstrap submission. Configure the trusted publisher and keep the submission pending until the first real release is published. Rejecting the only pending submission before that can remove the placeholder and its trusted-publisher configuration.

Keep the directory empty except for `package.json`. The command registers the name without provenance; do not use it to release the actual verifier.

## Connect GitHub to npm

Set these values under **Trusted Publisher** in the npm package settings:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Owner | `extraara` |
| Repository | `extraara-verifier` |
| Workflow filename | `npm-stage.yml` |
| Environment | `npm` |
| Allowed action | Staged publishing only |

Leave direct publishing and dist-tag management disabled. The workflow uses short-lived OIDC credentials, so it needs no stored npm token. Before the first submission with provenance, read the transparency-log notice linked from the npm documentation.

## Prepare a release

Update `package.json`, the changelog and any affected installation instructions in a pull request. Versions must use `major.minor.patch`; prerelease versions are not supported by this workflow.

Run:

```sh
npm test
npm run test:release
npm run check:package
```

The package check writes the archive, file list and hashes to `.release/`, which Git ignores. It installs the archive offline, compares its files with the checkout, tests the API and CLI, and checks that a changed document fails verification. Provenance is generated later in GitHub Actions.

## Publish

After the repository owner has reviewed and merged the latest revision:

1. Run **Stage npm release** from `main` in GitHub Actions. Enter the exact package version and approve the `npm` environment job.
2. The job checks the repository, branch, commit and version, then tests and packs the code. It submits the tested archive to npm with provenance.
3. Review the pending package on npm and approve it with two-factor authentication. Only this approval publishes the version with the `latest` tag.
4. Install that version in a fresh project and run `npm audit signatures`. Check for a verified provenance attestation as well as a registry signature. The source commit and workflow link on npm must match the reviewed revision and its successful release run.
5. After the first real release is published, reject the pending `0.0.0-bootstrap` submission. Do not approve it.
6. Update the developer website to use npm after these checks pass. Keep the ZIP available until then.

If a job fails after submission, check npm for a pending package before retrying. Never overwrite or republish an existing version.

Provenance identifies the source commit and workflow run. It does not replace code review or certify records checked by the verifier.

## npm documentation

- [Provenance](https://docs.npmjs.com/generating-provenance-statements/)
- [Trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [Trusted-publisher prerequisites](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [Staged publishing and the initial placeholder](https://docs.npmjs.com/staged-publishing/)
