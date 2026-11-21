# Contributing

Use Node.js 24 or later. Run `npm test` before submitting a change. The tests work offline and need no credentials.

For packaging or release changes, also run:

```sh
npm run test:release
npm run check:package
```

The package check installs the packed archive in a temporary project, compares its files with the checkout and tests the installed API and CLI. It does not publish the package.

Changes to the record structure, signed bytes, trust checks or observation rules need regression tests and updated documentation. If a change gives existing fields a different meaning, use a new protocol version.

Use synthetic records and temporary test keys. Keep personal documents, recordings, access tokens and production keys out of the repository.

Put protocol explanations in `docs/` and keep explanatory comments out of source files. Preserve license and attribution notices.

Contributions use Apache-2.0. Submit only material you have permission to share. Contributions do not grant access to the commercial apps or signing infrastructure.
