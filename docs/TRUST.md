# Trust and limits

A valid signature confirms that the signed bytes have not changed. It does not show whether the recorder reported events truthfully.

## What the results mean

| Result | Question |
| --- | --- |
| Integrity | Do the signature, sequence and hash chain verify? |
| Document binding | Does the supplied file match the signed hash and byte count? |
| Signer trust | Does the key match a fingerprint configured independently? |
| Observations | Which events and gaps did the recorder report? |
| Policy | Did the requirements selected by the caller pass? |

A key inside a record does not identify a person. Obtain trusted fingerprints through a separate channel, not from the same untrusted sender. Each deployment needs a way to register signers and manage their keys.

## Offline checks

The verifier does not contact Extraara, an institution, a timestamp authority or a revocation service. Times come from the recorder; key revocation status is unknown. An offline check can therefore accept a valid signature from a key that has since been revoked.

Existing records can be checked without recording permission, an activation code or a subscription.

## Observation limits

The supported assurance value is `localObservation`. It does not prove human authorship, the source of ideas, absence of AI, trusted hardware, a protected input path or uninterrupted capture.

Keyboard events are not character counts. A paste shortcut does not confirm that text was inserted. Focused-text changes may come from paste, dictation, replacement or other editing. Word's local and remote event labels do not identify an author.

Gaps and source hints remain in the session's results. Waiting or typing more does not clear them. Unknown event types do not increase the reported assurance.

## Other formats

This verifier checks signed JSON records and package manifests. PDF signatures, certificate chains, trusted timestamps and ZIP extraction need separate tools. Report an unperformed check as such.

The included examples use synthetic data and test identities. They are not records from trusted institutions.
