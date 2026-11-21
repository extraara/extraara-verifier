# Test files

All records here are synthetic and use test keys.

| Files | Purpose |
| --- | --- |
| `synthetic-certificate.json`, `synthetic-document.txt` | Record and document from the native Swift implementation |
| `node-synthetic-certificate.json`, `node-synthetic-document.txt` | Record and document from the Node implementation |
| `synthetic-word-certificate.json`, `synthetic-word-document.docx` | Word observation profile and its bound document |
| `wire-vectors.json` | SHA-256 checkpoints for the Swift record |
| `adversarial/` | Invalid records, including correctly signed records with structural errors |
| `package/` | Signed manifest, record and matching document |
| `extraproof-certificate.json`, `extraproof-document.txt` | Unchanged test files from the ExtraProof SDK |
| `extraproof-environment-certificate.json` | SDK example that must fail because its signed environment claim is unsupported |

Do not reformat signed fixtures. Whitespace and field order inside the encoded payload are part of the signed bytes.

Tests that modify records create temporary signing keys. No production private keys are included.
