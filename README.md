# Extraara Verifier

Check signed ExtraProof Creation Records and Extraara package manifests locally.

The verifier checks Ed25519 signatures, event chains and document hashes. It needs Node.js 24 or later, has no package dependencies and makes no network requests. No account or subscription is needed.

## Quick start

Run these commands from the repository directory:

    node bin/extraara-verify.mjs record fixtures/extraproof-certificate.json --document fixtures/extraproof-document.txt
    node bin/extraara-verify.mjs package fixtures/package/manifest.json fixtures/package/record.json --document fixtures/package/document.txt --json
    npm test

The examples use synthetic data and test keys. A valid example signature does not identify a real person or institution.

For a Word submission, extract `creation-manifest.json`, `creation-record.json` and the document, then pass them to the `package` command.

## Results

The result answers separate questions:

- **Integrity:** are the signature and event chain valid?
- **Document:** does the supplied file match the signed hash and byte count?
- **Signer:** does the signing key match a fingerprint you already trust?
- **Observations:** what input events and gaps did the recorder report?

To check the signer, pass `--trusted-key` with a full lowercase SHA-256 fingerprint obtained through a separate, trusted channel. Copying the fingerprint from the record itself does not identify its sender.

| Exit code | Meaning |
| --- | --- |
| 0 | All requested checks passed |
| 1 | Verification failed |
| 2 | The signer did not match the supplied fingerprint |
| 64 | Invalid arguments |
| 66 | A file could not be read, changed during reading, exceeded a size limit or was not a regular file |

Without a document or trusted fingerprint, a successful run leaves those checks unresolved.

## Supported formats

| Input | Version | Checks |
| --- | --- | --- |
| JSON record | `extraproof/1` | Signature, event chain, limits and supported observation profiles |
| JSON manifest | `extraara-package/0.1` | Signature, record reference and document binding |
| Original document | Any file up to 64 MiB | Exact SHA-256 hash and byte count |

Unsupported signed assurance, native-input or environment claims cause verification to fail. The result still reports record integrity separately.

A PDF can be checked as the original document. The verifier does not check PDF signatures or certificate chains, assess PAdES conformance, or extract ZIP files and attachments.

A valid signature confirms the signed bytes. It cannot confirm that reported events happened, identify the author or rule out AI use. It does not establish trusted hardware or time, or check whether a key has since been revoked. See [Trust and limits](docs/TRUST.md).

## Use from JavaScript

    import { readFileSync } from 'node:fs';
    import { verifyCertificate } from './src/index.mjs';

    const report = verifyCertificate(readFileSync('record.json'), {
      fileBytes: readFileSync('document.docx'),
      trustedKeyIDs: []
    });

    console.log(report.integrityValid, report.fileStatus, report.signerTrusted);

See the [API reference](docs/API.md) for options, return values and size limits. The [record format](docs/RECORD-FORMAT.md) and [package format](docs/PACKAGE-FORMAT.md) describe the signed data.

## npm

Install version `0.1.0` and check its signatures:

    npm install --save-exact @extraara/verifier@0.1.0
    npm audit signatures

Then import from `@extraara/verifier` or run `npx --no-install extraara-verify`.

The release workflow uses GitHub Actions and npm provenance. Provenance links a package version to its source commit and workflow run; it does not certify the code's safety. Maintainers can find setup instructions in [Releasing](docs/RELEASING.md).

## License

The verifier's code, documentation, schemas and synthetic test data are licensed under Apache-2.0. You may use, modify and redistribute them, including in commercial products, under the terms in [LICENSE](LICENSE) and [NOTICE](NOTICE).

This license covers the verifier only. It does not cover the ExtraProof apps, editor integration UI, account or license services, or production signing material.
