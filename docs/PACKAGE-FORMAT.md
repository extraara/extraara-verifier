# Extraara package 0.1

An `extraara-package/0.1` manifest links one `extraproof/1` record to one exported document. It is a JSON envelope, not an archive.

## Envelope

The envelope has exactly these fields:

| Field | Value |
| --- | --- |
| `schemaVersion` | `extraara-package/0.1` |
| `algorithm` | `Ed25519` |
| `keyID` | Lowercase SHA-256 of the raw 32-byte public key |
| `publicKey` | Canonical standard Base64 |
| `payload` | Base64 of the exact UTF-8 manifest bytes |
| `signature` | Base64 of the raw 64-byte signature |

The signature covers UTF-8 `Extraara.Package.v0.1`, one zero byte, then the decoded payload bytes. Use the stored payload bytes; do not reserialize the JSON before checking its signature.

## Manifest

The decoded manifest has exactly seven fields: `version`, `packageID`, `document`, `record`, `privacyProfile`, `extensions` and `criticalExtensions`. IDs are lowercase UUID strings.

`document` contains `algorithm: sha256`, `digest`, `byteCount`, `mediaType`, `role: export-artifact` and `documentID`. The digest covers the complete exported file, including container metadata. Supported media types are:

- `text/plain`
- `application/pdf`
- `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

`record` contains `algorithm: sha256`, `digest`, `byteCount`, `format`, `sessionID`, `headHash` and `keyID`. The digest covers the complete original record envelope. The signed `format` must match both the record envelope and its header.

The manifest and record must have the same signer. Their session ID, chain head, key ID and document binding must also match. Verification fails if the record is invalid or mismatched, even when the manifest signature is valid.

## Privacy profiles

| Profile | Accepted data |
| --- | --- |
| `synthetic-demo-v1` | Restricted synthetic baseline and gap events; no real writing records |
| `word-minimized-v1` | Supported Word fields with an empty display filename |
| `minimized-v1` | Reserved; this verifier does not accept it for real data |

The verifier checks nested signed fields against the profile. Unknown fields or unreviewed extensions can block the privacy check even when the signature is valid. The result reports both checks separately.

## Extensions

`extensions` is an object with at most eight entries. Keys must match the JSON schema's pattern. `criticalExtensions` lists distinct keys that also appear in `extensions`.

Version 0.1 supports no critical extensions, so a nonempty `criticalExtensions` list fails verification. Unknown noncritical extensions block the privacy check and do not increase assurance.

## Missing inputs

Without a document, `documentBinding` is `not-checked`. A supplied document that does not match causes an error. To check signer trust, supply fingerprints from a separate trusted source.

JSON schemas check structure only. Implementations must also check the original bytes, size limits, signatures, references and [record format](RECORD-FORMAT.md).
