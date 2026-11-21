# Observation profiles

The verifier summarizes events after their signatures and event chain have been checked. The events remain claims from the recorder; these checks do not prove that input occurred or identify the document's author.

## Keyboard

Version 1 uses `telemetry_started` and `input_activity` with `inputEvidenceVersion` set to `1` and `pasteDetection` set to `command_v_keycode_hint`.

Counters cover the whole session. Later input does not clear earlier gaps or unsupported segments. The [record format](RECORD-FORMAT.md) defines the fields and how counters are added.

These event definitions apply to the macOS recorder. Unknown platform-specific events remain signed data, but the verifier does not interpret them as keyboard or authorship evidence.

## Focused text

`accessibility_status` and `accessibility_text_observation` use `axEvidenceVersion: 1` and `scope: focused_text_control`. A `fieldEpoch` identifies the observed text control.

A baseline stores the text's UTF-16 length. A change stores the previous and current lengths, estimated insertions and deletions, sampling interval, keyboard-event count and keyboard coverage. It must use the baseline's field epoch, and its length calculations must agree.

| Check | Threshold |
| --- | --- |
| Text length | At most 100,000 UTF-16 units |
| Change interval | At most 5,000 milliseconds |
| `largeChangeCount` | At least 80 estimated inserted or deleted units |
| `lowKeyboardGrowthCount` | Growth of at least 80 units, keyboard coverage available, at most five keyboard events and at most 2,500 milliseconds |

These counts cannot distinguish paste, dictation, autocorrection, automation or human composition. Missing coverage or malformed fields prevent a complete assessment.

## Word

The verifier selects `extraproof.word/1` when the recorder version starts with `extraproof-word/` or the record contains `word.` events. The profile requires a completed observation-mode session for `com.microsoft.Word`.

| Event | Accepted position |
| --- | --- |
| `word.session.started` | First event; declares `body.text` and `snapshot+paragraph-events` |
| `word.snapshot`, reason `baseline` | Initial snapshot with zero change estimates |
| `word.snapshot`, reason `change` or `poll` | Active session |
| `word.event` | Active session, after any required resume snapshot |
| `word.coverage.gap` | Supported session states; retained in cumulative coverage results |
| `word.session.paused` | Active session; also counts as a coverage gap |
| `word.session.resumed` | Paused session; must be followed by a resume snapshot |
| `word.snapshot`, reason `resume` | Immediately after resume, before normal events |
| `word.snapshot`, reason `final` | Last snapshot before document export |
| `word.export` | After the final snapshot; binds the exact DOCX bytes |
| `word.session.ended` | After export |

The profile allows 5–20,000 events, snapshots of up to 8,000,000 UTF-16 units and up to 100,000 paragraphs. Snapshot counters use canonical nonnegative decimal strings. Common-prefix-suffix estimates must agree with the previous and current lengths. A zero change requires an unchanged snapshot hash.

Paragraph event sources are `local`, `remote` or `unknown`; snapshot sources can also be `mixed`. These labels do not identify a person. Only sampled text from the main document body is covered.

The export event links the final body snapshot hash to the signed document binding. Matching DOCX bytes confirm this link, but do not prove that the session produced all of the document's content.

## Package baseline and gaps

The `synthetic-demo-v1` package profile accepts:

- `adapter.baseline` with `scope: export-only` and `initialContent: unknown`.
- `adapter.gap` with `reason: not-observed`. Each occurrence adds a gap indicator to the package result.

This profile requires a synthetic record and cannot be used for real writing records.
