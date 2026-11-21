# API

Import from `src/index.mjs` in a source checkout or `@extraara/verifier` after installing a published npm version. Verification runs synchronously and does not read files or make network requests.

## verifyCertificate(recordBytes, options)

`recordBytes` is a `Uint8Array` containing an `extraproof/1` JSON envelope.

| Option | Type | Default |
| --- | --- | --- |
| `fileBytes` | `Uint8Array` | Omitted |
| `trustedKeyIDs` | Up to 256 distinct lowercase SHA-256 strings | Empty array |

Invalid arguments throw `TypeError`. Invalid record bytes return a result with entries in `errors`.

The result includes `schemaVersion`, `integrityValid`, `isValid`, `signerTrusted`, `fileStatus`, `keyID`, `sessionID`, `eventCount`, `synthetic`, `errors`, `warnings` and any applicable observation assessment. `schemaVersion` is `null` for an unsupported format or algorithm.

`isValid` is true when the record integrity check and any requested document comparison pass, with no verification errors. Unsupported signed claims are errors. `isValid` does not require a trusted signer: applications that require one must also check `signerTrusted`.

`fileStatus` is `notBound`, `notChecked`, `matched` or `mismatched`. Supplying a document for an unbound record is an error.

## verifyBundle(manifestBytes, recordBytes, documentBytes, options)

The manifest and record are `Uint8Array` values. `documentBytes` may be `undefined`.

Options accept `trustedKeyIDs` and an optional policy:

    {
      id: "institution-review",
      version: "1",
      requirePinnedKey: true,
      allowSynthetic: false
    }

All four policy fields are required. The verifier adds `requireDocumentMatch: true` to `appliedPolicy`. Every condition must pass for the policy to succeed.

The result includes `packageIntegrity`, `recordIntegrity`, `documentBinding`, `signerTrust`, `policy`, `privacy`, `revocation`, `trustedTime` and `errors`. Before accepting a package, check that `errors` is empty and that each result required by your application passed. Checking the manifest signature alone is not enough.

`privacy` reports whether the signed fields fit the declared data profile. It does not assess legal compliance. Show a blocked privacy result even when signature checks pass.

The report is unsigned and may include fields supplied by the record's sender. Handle those fields as untrusted input when displaying, logging or sharing them.

## Limits

| Input | Maximum |
| --- | ---: |
| Record envelope | 16 MiB |
| Package envelope | 128 KiB |
| Decoded package manifest | 64 KiB |
| Document | 64 MiB |
| Decoded record header or event body | 16 KiB |
| Record events | 100,000 |
| JSON nesting | 32 |

The CLI reads local regular files, enforces these size limits and detects changes during reading. It does not fetch network files, extract archives or validate PDF signatures.
