import { createHash, createPublicKey, verify } from 'node:crypto';
import { parseStrictJSON } from './json.mjs';
import { assessWriting } from './writing-assessment.mjs';
import { assessWord } from './word-assessment.mjs';

export const RECORD_VERSION = 'extraproof/1';
export const MAX_CERTIFICATE_BYTES = 16 * 1024 * 1024;
const hash = (data) => createHash('sha256').update(data).digest();
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const record = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const hex = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const uint = (x) => Number.isSafeInteger(x) && x >= 0;
const string = (x) => typeof x === 'string';
const boundedString = (x, min, max) =>
  string(x) && Buffer.byteLength(x, 'utf8') >= min && Buffer.byteLength(x, 'utf8') <= max;
const uint64 = (n) => {
  const out = Buffer.alloc(8);
  out.writeBigUInt64BE(BigInt(n));
  return out;
};
export function decodeBase64(value, max = MAX_CERTIFICATE_BYTES) {
  check(string(value) && value.length <= Math.ceil(max / 3) * 4, 'Base64 data exceeds limit.');
  check(value.length % 4 === 0 && !/[^A-Za-z0-9+/=]/.test(value), 'Malformed base64.');
  const result = Buffer.from(value, 'base64');
  check(result.length <= max && result.toString('base64') === value, 'Non-canonical base64.');
  return result;
}

export function verifyCertificate(input, { fileBytes, trustedKeyIDs = [] } = {}) {
  const result = {
    schemaVersion: null,
    integrityValid: false,
    signerTrusted: false,
    fileStatus: 'notBound',
    isValid: false,
    sessionID: null,
    eventCount: 0,
    synthetic: false,
    errors: [],
    warnings: [],
    evidence: [],
    keyID: null,
  };
  try {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    check(data.length <= MAX_CERTIFICATE_BYTES, 'Certificate exceeds 16 MiB.');
    const envelope = parseStrictJSON(data);
    check(record(envelope), 'Envelope must be an object.');
    check(
      envelope.schemaVersion === RECORD_VERSION && envelope.algorithm === 'Ed25519',
      'Unsupported certificate version or algorithm.',
    );
    result.schemaVersion = envelope.schemaVersion;
    const publicKey = decodeBase64(envelope.publicKey, 32);
    const signature = decodeBase64(envelope.signature, 64);
    check(publicKey.length === 32 && signature.length === 64, 'Wrong key or signature length.');
    const keyID = hash(publicKey).toString('hex');
    check(hex(envelope.keyID) && keyID === envelope.keyID, 'Signer fingerprint mismatch.');
    const bytes = decodeBase64(envelope.payload);
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: publicKey.toString('base64url') },
      format: 'jwk',
    });
    check(
      verify(
        null,
        Buffer.concat([Buffer.from('ExtraProof.Certificate.v1\0'), bytes]),
        key,
        signature,
      ),
      'Certificate signature is invalid.',
    );
    const payload = parseStrictJSON(bytes);
    check(record(payload), 'Payload must be an object.');
    const headerBytes = decodeBase64(payload.header, 16_384);
    const header = parseStrictJSON(headerBytes);
    check(
      record(header) && header.protocolVersion === envelope.schemaVersion,
      'Signed header version differs from the record version.',
    );
    check(
      string(header.sessionID) &&
        /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(header.sessionID),
      'Invalid session ID.',
    );
    check(uint(header.startedAtMilliseconds), 'Invalid start timestamp.');
    check(
      boundedString(header.targetBundleID, 1, 512) && boundedString(header.recorderVersion, 1, 128),
      'Invalid recorder or target application.',
    );
    check(
      header.mode === 'observation' || header.mode === 'sealedObservation',
      'Unsupported mode.',
    );
    check(header.assurance === 'localObservation', 'Unsupported or overstated assurance level.');
    check(typeof header.synthetic === 'boolean', 'Synthetic marker must be explicit.');
    check(
      Array.isArray(payload.events) && payload.events.length <= 100_000,
      'Invalid event list or event limit exceeded.',
    );
    check(
      record(payload.completion) && uint(payload.completion.endedAtMilliseconds),
      'Invalid completion.',
    );
    check(
      ['completed', 'interrupted'].includes(payload.completion.status),
      'Invalid completion status.',
    );
    let previous = hash(Buffer.concat([Buffer.from('ExtraProof.Session.v1\0'), headerBytes]));
    const eventDomain = Buffer.from('ExtraProof.Event.v1\0');
    let monotonic = 0n;
    let wallTime = header.startedAtMilliseconds;
    let clockWarning = payload.completion.endedAtMilliseconds < wallTime;
    const kinds = new Set();
    const observations = [];
    for (let i = 0; i < payload.events.length; i++) {
      const event = payload.events[i];
      check(
        record(event) && event.sequence === i && uint(event.sequence),
        'Event sequence is discontinuous.',
      );
      check(
        hex(event.previousHash) && event.previousHash === previous.toString('hex'),
        'Broken previous-event hash.',
      );
      const bodyBytes = decodeBase64(event.body, 16_384);
      const body = parseStrictJSON(bodyBytes);
      check(
        record(body) && boundedString(body.kind, 1, 128) && uint(body.timestampMilliseconds),
        'Invalid event body.',
      );
      check(
        string(body.monotonicNanoseconds) &&
          /^(0|[1-9][0-9]{0,19})$/.test(body.monotonicNanoseconds),
        'Invalid monotonic timestamp encoding.',
      );
      const current = BigInt(body.monotonicNanoseconds);
      check(
        current <= 18_446_744_073_709_551_615n && current >= monotonic,
        'Monotonic clock moved backwards or overflowed.',
      );
      check(
        record(body.metadata) &&
          Object.keys(body.metadata).length <= 32 &&
          Object.entries(body.metadata).every(
            ([k, v]) => boundedString(k, 1, 128) && boundedString(v, 0, 2048),
          ),
        'Metadata must contain strings only.',
      );
      monotonic = current;
      clockWarning ||=
        body.timestampMilliseconds < wallTime ||
        body.timestampMilliseconds > payload.completion.endedAtMilliseconds;
      wallTime = body.timestampMilliseconds;
      kinds.add(body.kind);
      observations.push(body);
      previous = hash(
        Buffer.concat([
          eventDomain,
          previous,
          uint64(i),
          uint64(bodyBytes.length),
          bodyBytes,
        ]),
      );
      check(hex(event.hash) && event.hash === previous.toString('hex'), 'Event hash mismatch.');
    }
    check(
      hex(payload.headHash) && payload.headHash === previous.toString('hex'),
      'Final chain head mismatch.',
    );
    const binding = payload.completion.fileBinding;
    if (binding !== undefined && binding !== null) {
      check(
        record(binding) && hex(binding.sha256) && uint(binding.byteCount),
        'Invalid document binding.',
      );
      check(boundedString(binding.fileName, 0, 4096), 'Invalid document display name.');
      result.fileStatus = 'notChecked';
      if (fileBytes !== undefined) {
        result.fileStatus =
          binding.sha256 === hash(fileBytes).toString('hex') &&
          binding.byteCount === fileBytes.length
            ? 'matched'
            : 'mismatched';
        if (result.fileStatus === 'mismatched')
          result.errors.push('The supplied document does not match the certificate.');
      }
    } else if (fileBytes !== undefined)
      result.errors.push('The certificate does not bind a document.');
    const hasWordEvidence =
      header.recorderVersion.startsWith('extraproof-word/') ||
      observations.some((observation) => observation.kind.startsWith('word.'));
    if (hasWordEvidence) {
      check(
        header.targetBundleID === 'com.microsoft.Word' &&
          header.mode === 'observation' &&
          payload.completion.status === 'completed',
        'Word evidence requires a completed Word observation session.',
      );
      result.wordAssessment = assessWord(observations, {
        binding,
        startedAt: header.startedAtMilliseconds,
        endedAt: payload.completion.endedAtMilliseconds,
      });
    } else result.writingAssessment = assessWriting(observations);
    result.integrityValid = true;
    const hasAdditionalClaims =
      ['assurancePolicy', 'inputProvenancePolicy', 'environmentPolicy', 'environmentProtection']
        .some((field) => Object.hasOwn(header, field)) ||
      ['assurance', 'environmentProtection'].some((field) => Object.hasOwn(payload, field));
    if (hasAdditionalClaims) {
      result.errors.push('Additional signed assurance or environment claims require a verifier that supports them.');
    }
    result.keyID = keyID;
    result.signerTrusted = trustedKeyIDs.includes(keyID);
    result.sessionID = header.sessionID;
    result.eventCount = payload.events.length;
    result.synthetic = header.synthetic;
    result.evidence = [...kinds].sort();
    result.warnings.push(
      'Local recorder claims only; no proof of human authorship, thought origin, event truth or trusted time.',
    );
    if (hasWordEvidence) {
      result.evidence.push(
        'Word snapshots cover main-body text only; the export is separately bound to exact DOCX bytes.',
      );
      result.warnings.push(
        'Snapshot differences and Word local/remote events do not identify a person, paste operation or text origin. Changes between snapshots and outside add-in runtime may be missed.',
      );
      if (result.wordAssessment.gapCount > 0)
        result.warnings.push(
          'Word observation gaps were recorded and remain part of this session.',
        );
    } else {
      result.warnings.push(
        'Text origin is unknown; keyboard and paste-shortcut signals do not identify document passages.',
      );
      if (!result.writingAssessment.trackingSupported)
        result.warnings.push(
          'Paste-shortcut detection was not declared by a supported recorder in this session.',
        );
      else if (!result.writingAssessment.trackingComplete)
        result.warnings.push('Paste-shortcut detection was not declared for every input segment.');
      if (result.writingAssessment.pasteShortcutCount > 0)
        result.warnings.push(
          'Paste shortcuts were observed; this does not establish whether text was inserted or where it originated.',
        );
      if (result.writingAssessment.malformedEvidence)
        result.warnings.push(
          'Writing evidence contains malformed or overflowing counters; counts are incomplete and cannot support a positive provenance claim.',
        );
    }
    if (!result.signerTrusted)
      result.warnings.push('Signer key is self asserted and not independently trusted.');
    if (header.synthetic)
      result.warnings.push('Synthetic test session; not real writing evidence.');
    if (payload.events.length === 0) result.warnings.push('No observations were recorded.');
    if (clockWarning) result.warnings.push('Local wall-clock discontinuity detected.');
    if (payload.completion.status === 'interrupted')
      result.warnings.push('Session was interrupted.');
    if (header.mode === 'sealedObservation')
      result.warnings.push(
        'Sealed observation does not enforce process, input or network isolation.',
      );
    if (result.fileStatus === 'notBound')
      result.warnings.push('No document is bound to this session.');
    if (result.fileStatus === 'notChecked')
      result.warnings.push('Document bytes were not supplied and have not been checked.');
    result.isValid = result.errors.length === 0;
  } catch (error) {
    result.errors.push(error.message);
  }
  return result;
}
