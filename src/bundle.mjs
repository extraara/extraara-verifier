import { createHash, createPublicKey, verify } from 'node:crypto';
import { parseStrictJSON } from './json.mjs';
import { verifyCertificate, decodeBase64, RECORD_VERSION } from './verifier.mjs';

export const PACKAGE_VERSION = 'extraara-package/0.1';
export const DOMAIN = Buffer.from('Extraara.Package.v0.1\0');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => {
  throw new Error(code);
};
const check = (value, code) => {
  if (!value) fail(code);
};
const uint = (x) => Number.isSafeInteger(x) && x >= 0;
const hex = (x) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const uuid = (x) =>
  typeof x === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(x);
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, names) =>
  obj(x) && Object.keys(x).length === names.length && names.every((n) => Object.hasOwn(x, n));
const bytes = (x) => Buffer.isBuffer(x) || x instanceof Uint8Array;
const descriptor = (x, names) =>
  exact(x, names) && x.algorithm === 'sha256' && hex(x.digest) && uint(x.byteCount);
export function validateManifest(m) {
  check(
    exact(m, [
      'version',
      'packageID',
      'document',
      'record',
      'privacyProfile',
      'extensions',
      'criticalExtensions',
    ]),
    'E_MANIFEST_FIELDS',
  );
  check(m.version === PACKAGE_VERSION && uuid(m.packageID), 'E_VERSION_OR_ID');
  check(
    descriptor(m.document, [
      'algorithm',
      'digest',
      'byteCount',
      'mediaType',
      'role',
      'documentID',
    ]) &&
      m.document.byteCount <= 64 * 1024 * 1024 &&
      [
        'text/plain',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ].includes(m.document.mediaType) &&
      m.document.role === 'export-artifact' &&
      uuid(m.document.documentID),
    'E_DOCUMENT_DESCRIPTOR',
  );
  check(
    descriptor(m.record, [
      'algorithm',
      'digest',
      'byteCount',
      'format',
      'sessionID',
      'headHash',
      'keyID',
    ]) &&
      m.record.byteCount <= 16 * 1024 * 1024 &&
      m.record.format === RECORD_VERSION &&
      uuid(m.record.sessionID) &&
      hex(m.record.headHash) &&
      hex(m.record.keyID),
    'E_RECORD_DESCRIPTOR',
  );
  check(
    ['synthetic-demo-v1', 'minimized-v1', 'word-minimized-v1'].includes(m.privacyProfile),
    'E_PRIVACY_PROFILE',
  );
  check(
    obj(m.extensions) &&
      Object.keys(m.extensions).length <= 8 &&
      Object.keys(m.extensions).every((k) => /^[a-z][a-z0-9.-]{0,63}$/.test(k)),
    'E_EXTENSIONS',
  );
  check(
    Array.isArray(m.criticalExtensions) &&
      m.criticalExtensions.length <= 8 &&
      new Set(m.criticalExtensions).size === m.criticalExtensions.length &&
      m.criticalExtensions.every((k) => typeof k === 'string' && Object.hasOwn(m.extensions, k)),
    'E_CRITICAL_LIST',
  );
  check(m.criticalExtensions.length === 0, 'E_UNKNOWN_CRITICAL_EXTENSION');
  return m;
}
export function decodeRecord(recordBytes) {
  const envelope = parseStrictJSON(recordBytes);
  const payload = parseStrictJSON(decodeBase64(envelope.payload));
  const header = parseStrictJSON(decodeBase64(payload.header));
  const events = payload.events.map((e) => parseStrictJSON(decodeBase64(e.body)));
  return { envelope, payload, header, events };
}
export function assessPrivacy(recordBytes, profile) {
  const reasons = [];
  try {
    const { envelope: e, payload: p, header: h, events } = decodeRecord(recordBytes);
    if (
      !exact(e, ['schemaVersion', 'algorithm', 'keyID', 'publicKey', 'payload', 'signature']) ||
      !exact(p, ['header', 'events', 'headHash', 'completion']) ||
      !exact(h, [
        'protocolVersion',
        'sessionID',
        'startedAtMilliseconds',
        'targetBundleID',
        'mode',
        'assurance',
        'synthetic',
        'recorderVersion',
      ]) ||
      !exact(p.completion, ['endedAtMilliseconds', 'status', 'fileBinding']) ||
      !exact(p.completion.fileBinding, ['sha256', 'byteCount', 'fileName'])
    )
      reasons.push('unknown-or-missing-fields');
    if (p.events.some((x) => !exact(x, ['sequence', 'body', 'previousHash', 'hash'])))
      reasons.push('unknown-chain-fields');
    if (p.completion.fileBinding?.fileName !== '') reasons.push('display-filename-present');
    if (profile === 'word-minimized-v1') {
      const report = verifyCertificate(recordBytes);
      if (!report.integrityValid || !report.wordAssessment) reasons.push('word-record-invalid');
      if (
        h.targetBundleID !== 'com.microsoft.Word' ||
        h.recorderVersion !== 'extraproof-word/0.1.0' ||
        h.mode !== 'observation' ||
        h.assurance !== 'localObservation'
      )
        reasons.push('unreviewed-word-recorder');
      if (p.completion.status !== 'completed') reasons.push('word-incomplete');
      for (const event of events) {
        if (!exact(event, ['kind', 'timestampMilliseconds', 'monotonicNanoseconds', 'metadata']))
          reasons.push('unknown-event-fields');
        if (
          event.kind === 'word.session.started' &&
          !/^[0-9]{1,8}(\.[0-9]{1,8}){0,3}$/.test(event.metadata.hostVersion)
        )
          reasons.push('unreviewed-host-version');
      }
      return {
        status: reasons.length ? 'blocked' : h.synthetic ? 'synthetic-only' : 'minimized-local',
        profile,
        reasons: [...new Set(reasons)],
        legalApproval: false,
      };
    }
    if (
      h.targetBundleID !== 'extraara.synthetic' ||
      h.recorderVersion !== 'extraara-fixture/0.1' ||
      h.mode !== 'observation'
    )
      reasons.push('unreviewed-recorder-profile');
    if (!h.synthetic || profile !== 'synthetic-demo-v1')
      reasons.push('real-data-profile-not-approved');
    for (const e of events) {
      if (!exact(e, ['kind', 'timestampMilliseconds', 'monotonicNanoseconds', 'metadata']))
        reasons.push('unknown-event-fields');
      if (e.kind === 'adapter.baseline') {
        if (
          !exact(e.metadata, ['scope', 'initialContent']) ||
          e.metadata.scope !== 'export-only' ||
          e.metadata.initialContent !== 'unknown'
        )
          reasons.push('unreviewed-baseline');
      } else if (e.kind === 'adapter.gap') {
        if (!exact(e.metadata, ['reason']) || e.metadata.reason !== 'not-observed')
          reasons.push('unreviewed-gap');
      } else reasons.push('unknown-event-kind');
    }
  } catch {
    reasons.push('unparseable-record');
  }
  return {
    status: reasons.length ? 'blocked' : 'synthetic-only',
    reasons: [...new Set(reasons)],
    legalApproval: false,
  };
}

export function verifyBundle(manifestBytes, recordBytes, documentBytes, options = {}) {
  const result = {
    packageIntegrity: 'not-checked',
    recordIntegrity: 'not-checked',
    documentBinding: 'not-checked',
    signerTrust: 'unknown',
    identity: 'unknown',
    observation: {
      status: 'unknown',
      textOrigin: 'unknown',
      inputAttestation: 'none',
      deviceAttestation: 'none',
    },
    policy: 'not-evaluated',
    revocation: { status: 'unknown', checkedAt: null, ageSeconds: null },
    trustedTime: 'unavailable',
    privacy: { status: 'blocked', reasons: ['not-checked'], legalApproval: false },
    errors: [],
    warnings: [],
    reportIsSigned: false,
  };
  try {
    check(
      obj(options) && Object.keys(options).every((k) => ['trustedKeyIDs', 'policy'].includes(k)),
      'E_OPTIONS',
    );
    const pins = options.trustedKeyIDs ?? [];
    check(
      Array.isArray(pins) &&
        pins.length <= 256 &&
        pins.every(hex) &&
        new Set(pins).size === pins.length,
      'E_TRUST_CONFIG',
    );
    check(
      bytes(manifestBytes) &&
        bytes(recordBytes) &&
        (documentBytes === undefined || bytes(documentBytes)),
      'E_BYTES_REQUIRED',
    );
    check(
      manifestBytes.length <= 131072 &&
        recordBytes.length <= 16 * 1024 * 1024 &&
        (documentBytes === undefined || documentBytes.length <= 64 * 1024 * 1024),
      'E_SIZE',
    );
    const e = parseStrictJSON(manifestBytes);
    check(
      exact(e, ['schemaVersion', 'algorithm', 'keyID', 'publicKey', 'payload', 'signature']) &&
        e.schemaVersion === PACKAGE_VERSION &&
        e.algorithm === 'Ed25519',
      'E_ENVELOPE',
    );
    const raw = decodeBase64(e.payload, 65536),
      pk = decodeBase64(e.publicKey, 32),
      sig = decodeBase64(e.signature, 64);
    check(pk.length === 32 && sig.length === 64 && hex(e.keyID) && sha256(pk) === e.keyID, 'E_KEY');
    const key = createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: pk.toString('base64url') },
      format: 'jwk',
    });
    check(verify(null, Buffer.concat([DOMAIN, raw]), key, sig), 'E_PACKAGE_SIGNATURE');
    result.packageIntegrity = 'valid';
    const m = validateManifest(parseStrictJSON(raw));
    result.manifest = m;
    check(
      sha256(recordBytes) === m.record.digest && recordBytes.length === m.record.byteCount,
      'E_RECORD_HASH',
    );
    const legacy = verifyCertificate(recordBytes, {
      ...(documentBytes === undefined ? {} : { fileBytes: documentBytes }),
      trustedKeyIDs: options.trustedKeyIDs ?? [],
    });
    result.legacy = legacy;
    result.recordIntegrity = legacy.integrityValid ? 'valid' : 'invalid';
    check(legacy.integrityValid, 'E_RECORD_INTEGRITY');
    const { payload, header } = decodeRecord(recordBytes);
    check(
      m.record.format === legacy.schemaVersion &&
        m.record.sessionID === legacy.sessionID.toLowerCase() &&
        m.record.headHash === payload.headHash &&
        m.record.keyID === legacy.keyID &&
        e.keyID === legacy.keyID,
      'E_RECORD_REFERENCE',
    );
    const b = payload.completion.fileBinding;
    check(
      b && b.sha256 === m.document.digest && b.byteCount === m.document.byteCount,
      'E_SIGNED_BINDING',
    );
    result.documentBinding =
      documentBytes === undefined
        ? 'not-checked'
        : sha256(documentBytes) === m.document.digest &&
            documentBytes.length === m.document.byteCount &&
            legacy.fileStatus === 'matched'
          ? 'matched'
          : 'mismatched';
    result.signerTrust = legacy.signerTrusted ? 'pinned-key' : 'unknown';
    result.observation = {
      status:
        payload.completion.status === 'interrupted'
          ? 'interrupted'
          : legacy.eventCount === 0
            ? 'no-observations'
            : 'local-claims',
      assurance: header.assurance,
      synthetic: legacy.synthetic,
      knownGapIndicators:
        legacy.wordAssessment?.gapCount ?? legacy.writingAssessment?.gapCount ?? 0,
      coverage: 'incomplete-or-unknown',
      textOrigin: 'unknown',
      inputAttestation: 'none',
      deviceAttestation: 'none',
    };
    result.observation.knownGapIndicators += decodeRecord(recordBytes).events.filter(
      (x) => x.kind === 'adapter.gap',
    ).length;
    result.privacy = assessPrivacy(recordBytes, m.privacyProfile);
    if (Object.keys(m.extensions).length) {
      result.privacy = {
        status: 'blocked',
        reasons: ['unreviewed-extensions'],
        legalApproval: false,
      };
      result.warnings.push('Unknown noncritical extensions ignored for assurance.');
    }
    if (result.documentBinding === 'mismatched') result.errors.push('E_DOCUMENT_HASH');
    else if (!legacy.isValid) result.errors.push(...legacy.errors);
    if (options.policy) {
      const p = options.policy;
      check(
        exact(p, ['id', 'version', 'requirePinnedKey', 'allowSynthetic']) &&
          typeof p.id === 'string' &&
          p.id.length > 0 &&
          p.id.length <= 128 &&
          typeof p.version === 'string' &&
          p.version.length > 0 &&
          p.version.length <= 64 &&
          typeof p.requirePinnedKey === 'boolean' &&
          typeof p.allowSynthetic === 'boolean',
        'E_POLICY',
      );
      const failed =
        (p.requirePinnedKey && !legacy.signerTrusted) ||
        (!p.allowSynthetic && legacy.synthetic) ||
        result.documentBinding !== 'matched';
      result.policy = failed ? 'not-satisfied' : 'satisfied';
      result.policyID = p.id;
      result.appliedPolicy = { ...p, requireDocumentMatch: true };
    }
  } catch (error) {
    result.errors.push(error.message);
    if (result.packageIntegrity === 'not-checked') result.packageIntegrity = 'invalid';
  }
  result.syntheticTransportEligible =
    result.errors.length === 0 &&
    result.documentBinding === 'matched' &&
    result.privacy.status === 'synthetic-only' &&
    result.policy !== 'not-satisfied';
  return result;
}
