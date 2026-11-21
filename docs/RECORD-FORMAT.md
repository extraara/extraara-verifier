# ExtraProof record format v1

This document defines `extraproof/1`. The standalone verifier supports `localObservation`; other signed assurance or environment claims require a verifier that supports those profiles.

A record contains observations reported by its signer. It does not prove who wrote a document, where ideas came from, whether events happened as reported, or whether hardware and timestamps can be trusted.

## Envelope and exact signed bytes

The outer envelope is UTF-8 JSON. Its field order does not affect verification:

```json
{
  "schemaVersion": "extraproof/1",
  "algorithm": "Ed25519",
  "keyID": "<64 lowercase SHA256 hex of raw public key>",
  "publicKey": "<base64 raw 32-byte Ed25519 public key>",
  "payload": "<base64 exact UTF-8 payload JSON>",
  "signature": "<base64 raw 64-byte Ed25519 signature>"
}
```

The signature covers UTF-8 `ExtraProof.Certificate.v1`, one NUL byte (`00`), then the decoded payload bytes. Do not add a length prefix or canonicalize the JSON. Algorithm and schema-version names are case sensitive. The envelope supplies its own public key; callers must check `keyID` against a fingerprint they trust independently.

Decoded payload:

```json
{
  "header": "<base64 exact header JSON>",
  "events": [
    {
      "sequence": 0,
      "body": "<base64 exact observation JSON>",
      "previousHash": "<64 lowercase hex>",
      "hash": "<64 lowercase hex>"
    }
  ],
  "headHash": "<64 lowercase hex>",
  "completion": {
    "endedAtMilliseconds": 123,
    "status": "completed",
    "fileBinding": {
      "sha256": "<64 lowercase hex>",
      "byteCount": 123,
      "fileName": "optional-display-name.txt"
    }
  }
}
```

`fileBinding` is optional. `completion.status` is `completed` or `interrupted`. An empty event list is valid and is reported as an empty session.

The envelope limit is 16 MiB, with at most 100000 events. Each decoded event body and header is limited to 16384 bytes. Times, lengths and sequences must be nonnegative safe JSON integers (<= 9007199254740991). `monotonicNanoseconds` is a decimal string because JavaScript numbers cannot represent every UInt64 value exactly.

Decoded header JSON:

```json
{
  "protocolVersion": "extraproof/1",
  "sessionID": "<UUID>",
  "startedAtMilliseconds": 123,
  "targetBundleID": "com.soulmen.ulysses3",
  "mode": "observation",
  "assurance": "localObservation",
  "synthetic": false,
  "recorderVersion": "1.0.0"
}
```

`mode` is `observation` or `sealedObservation`. Sealed observation requests additional telemetry on a best-effort basis. It does not mean that input restrictions were enforced.

Decoded observation JSON:

```json
{
  "kind": "input.correlated",
  "timestampMilliseconds": 123,
  "monotonicNanoseconds": "12345",
  "metadata": { "source": "CGEvent" }
}
```

Telemetry must not contain characters, key codes, window titles, clipboard data or document text. New event kinds are allowed, but unknown kinds must not increase the reported assurance. Signed fields remain claims from the local recorder.

A local wall clock that moves backwards produces a warning. Recorder timestamps are not trusted time. Monotonic order must not decrease within a session.

## Event hash chain

Let SHA256 produce 32 bytes. `UTF8(x)` denotes exact UTF-8 bytes; `NUL` is one zero byte. `U64BE(n)` is an eight-byte unsigned big-endian integer.

```
anchor = SHA256(UTF8("ExtraProof.Session.v1") || NUL || decodedHeaderBytes)
eventHash[i] = SHA256(UTF8("ExtraProof.Event.v1") || NUL || previousHashBytes[32]
                      || U64BE(sequence) || U64BE(decodedBodyBytes.count) || decodedBodyBytes)
```

Sequences start at 0 with no gaps. The first `previousHash` is the anchor; each later one is the preceding calculated event hash. `headHash` is the final event hash, or the anchor for an empty session. Use the exact stored decoded bytes, including JSON whitespace, for hashes and signatures. Do not re-encode the JSON.

At finalization, the recorder streams the selected file through SHA256 and stores its hash and byte count. A matching document confirms byte equality, not that the session created the file. Without the document, report `notChecked`. A supplied document that does not match fails verification even when the record integrity check passes.

## Cumulative writing observations

Writing observations describe input signals and capture coverage separately from `localObservation` assurance. They do not identify human or AI authorship. The record contains no typed characters, clipboard text, raw key codes or origins of individual text sections.

A recorder declares support with `telemetry_started.metadata.inputEvidenceVersion = "1"`. The supported method is `pasteDetection = "command_v_keycode_hint"`. Each `input_activity` interval repeats both fields.

The method records a Command-V shortcut hint within the capture scope, including supported shift/option variants. It does not confirm that the application accepted a paste or changed any text. Coverage of menu commands, drag-and-drop, imports, remapped shortcuts and pre-existing text is incomplete.

The verifier computes the optional `VerificationReport.writingAssessment` after checking the signature, header, full event chain and completion. It is absent if cryptographic verification fails. The assessment is unsigned; other verifiers must compute it from the authenticated events.

Old report JSON without this property still decodes. Valid older records without detection support report that support as false; they do not receive a clean-history result.

Assessment fields:

| Field                         | Meaning                                                                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `trackingSupported`           | At least one start declares evidence version `1`.                                                                                                                                                                                                                     |
| `trackingComplete`            | Support exists and every observed start/input segment explicitly declares version `1` and the supported method. Any unsupported earlier segment permanently makes this false. This field is vocabulary coverage, **not** proof of continuous sensor delivery.         |
| `pasteShortcutCount`          | Sum of `input_activity.metadata.pasteShortcutCount`; hints, not confirmed insertions or inserted character counts.                                                                                                                                                    |
| `keyboardEventCount`          | Sum of `quartzKeyDown`; keyboard events, including shortcuts, not text characters.                                                                                                                                                                                    |
| `timingMatchCount`            | Sum of `timingCorrelated`; heuristic temporal matches, not human-authorship evidence.                                                                                                                                                                                 |
| `unknownSourceIndicatorCount` | Sum of `privateSourceStateIndicators` and `quartzWithoutTimingMatch`; these indicators may overlap and do not prove automation.                                                                                                                                       |
| `gapCount`                    | Number of coverage indicators: `observation_gap` except `state=end`, `clock_discontinuity`, `session.recovered`, and `capture_scope_changed` with `targetFocusedAndEligible=false`. Not a duration or count of unique interruptions.                                  |
| `malformedEvidence`           | At least one relevant counter is malformed, exceeds the safe-integer bound, overflows cumulatively, or an interval claims more paste shortcuts than Quartz key-down events. Integrity can still be valid; semantic counts cannot support a positive provenance claim. |
| `textOrigin`                  | Always `unknown` in this implementation, even with no paste hints, perfect timing correlation and a matching final file.                                                                                                                                              |

All counters use canonical nonnegative decimal strings in event metadata (no signs, spaces, decimal/exponent forms or leading zeroes except `0`), bounded by `9007199254740991`. Omitted sparse counters mean zero. Malformed individual values contribute zero and set `malformedEvidence`; previously observed evidence is retained. Aggregate overflow saturates at the same bound and sets the flag. A paste count exceeding its interval's key-down count is retained but marked malformed. Relevant hints in unsupported segments remain visible; unsupported status never erases them.

The assessment covers the entire session. Earlier paste hints and gaps remain after waiting, further typing, pauses, resumes or telemetry restarts. There is no rolling window, cooldown, confidence recovery, percentage of human text or elapsed-time rule. Starting a new session does not establish the origin of its initial text. Unknown event kinds do not improve the assessment.

The live UI computes the same assessment incrementally with `WritingAssessmentAccumulator.observe(_:)`. Exported verification uses `WritingAssessment.assess(observations:)` on the authenticated history.

## Parser and resource constraints

Reject duplicate JSON object keys at every level, including escaped spellings and Unicode canonically equivalent (NFC-equivalent) keys. Reject nesting deeper than 32, negative/fractional/exponent number encodings, unsafe integers, invalid UTF-8, malformed Unicode escapes and trailing non-whitespace data. Base64 must have the canonical RFC 4648 standard alphabet/padding (decode then re-encode comparison). Decimal monotonic strings have no sign or leading zero except the string `0`. Additional unknown object fields are ignored and convey no assurance; extensions that alter semantics require a protocol version change.

Each JSON parse is additionally limited to **1,000,000 values** in total and **100,000 entries per container**. The root counts as one value; every array element and object value counts, including nested containers, while object keys do not count as additional values. Container entries are array elements or object key/value pairs. Swift and Node enforce these allocation budgets before adding an over-budget entry. Limits apply separately to the envelope and each decoded payload/header/event parse; the existing byte limits also remain in force. Duplicate-key diagnostics do not echo attacker-supplied keys.

Field limits are measured in UTF-8 bytes: `targetBundleID` 1–512; `recorderVersion` 1–128; `kind` 1–128; at most 32 metadata entries; metadata keys 1–128 and values 0–2048; `fileName` 0–4096. Schema `maxLength` is an auxiliary character bound; the implementation additionally enforces bytes. Empty strings are allowed only where explicitly stated. JSON Schemas describe the decoded structures; schema validation alone cannot check signatures, exact-byte hashes, base64 decoded sizes, safe parser behavior or monotonic ordering.

See the [API reference](API.md) and [observation profiles](OBSERVATIONS.md) for result fields and profile rules.
