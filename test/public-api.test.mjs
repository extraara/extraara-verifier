import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyCertificate, verifyBundle } from '../src/index.mjs';
import { makeFixture, digest } from './fixture.mjs';

const load = (name) => readFileSync(new URL('../fixtures/' + name, import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const u64 = (value) => {
  const result = Buffer.alloc(8);
  result.writeBigUInt64BE(BigInt(value));
  return result;
};

function packageFixture(change = () => {}) {
  const fixture = makeFixture({
    observations: [
      {
        kind: 'adapter.baseline',
        timestampMilliseconds: 1100,
        monotonicNanoseconds: '1',
        metadata: { scope: 'export-only', initialContent: 'unknown' },
      },
      {
        kind: 'adapter.gap',
        timestampMilliseconds: 1200,
        monotonicNanoseconds: '2',
        metadata: { reason: 'not-observed' },
      },
    ],
    alterHeader: (value) => {
      value.targetBundleID = 'extraara.synthetic';
      value.recorderVersion = 'extraara-fixture/0.1';
    },
    alterPayload: (value) => {
      value.completion.fileBinding.fileName = '';
    },
  });
  const manifest = {
    version: 'extraara-package/0.1',
    packageID: '11111111-1111-4111-8111-111111111111',
    document: {
      algorithm: 'sha256',
      digest: digest(fixture.document),
      byteCount: fixture.document.length,
      mediaType: 'text/plain',
      role: 'export-artifact',
      documentID: '22222222-2222-4222-8222-222222222222',
    },
    record: {
      algorithm: 'sha256',
      digest: digest(fixture.bytes),
      byteCount: fixture.bytes.length,
      format: fixture.envelope.schemaVersion,
      sessionID: fixture.header.sessionID,
      headHash: fixture.payload.headHash,
      keyID: fixture.envelope.keyID,
    },
    privacyProfile: 'synthetic-demo-v1',
    extensions: {},
    criticalExtensions: [],
  };
  change(manifest);
  const payload = Buffer.from(JSON.stringify(manifest));
  const envelope = {
    schemaVersion: 'extraara-package/0.1',
    algorithm: 'Ed25519',
    keyID: fixture.envelope.keyID,
    publicKey: fixture.envelope.publicKey,
    payload: payload.toString('base64'),
    signature: sign(
      null,
      Buffer.concat([Buffer.from('Extraara.Package.v0.1\0'), payload]),
      fixture.privateKey,
    ).toString('base64'),
  };
  return { ...fixture, manifestBytes: Buffer.from(JSON.stringify(envelope)) };
}

test('Swift and Node records verify without services or licensed app components', () => {
  for (const prefix of ['synthetic', 'node-synthetic']) {
    const result = verifyCertificate(load(prefix + '-certificate.json'), {
      fileBytes: load(prefix + '-document.txt'),
    });
    assert.equal(result.isValid, true);
    assert.equal(result.synthetic, true);
    assert.equal(result.fileStatus, 'matched');
    assert.equal(result.signerTrusted, false);
  }
});

test('the checked-in SDK record verifies with the ExtraProof domains and the exact document bytes', () => {
  const ib = load('extraproof-certificate.json');
  const result = verifyCertificate(ib, { fileBytes: load('extraproof-document.txt') });
  assert.equal(result.isValid, true, result.errors.join(', '));
  assert.equal(result.schemaVersion, 'extraproof/1');
  assert.equal(result.fileStatus, 'matched');

  const record = JSON.parse(ib);
  record.schemaVersion = 'extraproof/0';
  assert.equal(verifyCertificate(Buffer.from(JSON.stringify(record))).integrityValid, false);
});

test('a valid signature cannot pair the current envelope with a different header version', () => {
  const fixture = makeFixture({
    alterHeader: header => { header.protocolVersion = 'extraproof/0'; },
  });
  const result = verifyCertificate(fixture.bytes);
  assert.equal(result.isValid, false);
  assert.match(result.errors[0], /header version differs/);
});

test('the offline verifier does not accept an unsupported signed environment claim', () => {
  const result = verifyCertificate(load('extraproof-environment-certificate.json'));
  assert.equal(result.integrityValid, true);
  assert.equal(result.isValid, false);
  assert.match(result.errors[0], /Additional signed assurance or environment claims/);
});

test('a signed package descriptor must use the actual embedded record format', () => {
  const valid = packageFixture();
  const result = verifyBundle(valid.manifestBytes, valid.bytes, valid.document);
  assert.deepEqual(result.errors, []);
  assert.equal(result.packageIntegrity, 'valid');
  assert.equal(result.recordIntegrity, 'valid');
  assert.equal(result.documentBinding, 'matched');

  const mismatch = packageFixture(manifest => {
    manifest.record.format = 'extraproof/0';
  });
  const rejected = verifyBundle(mismatch.manifestBytes, mismatch.bytes, mismatch.document);
  assert.deepEqual(rejected.errors, ['E_RECORD_DESCRIPTOR']);
});

test('stored byte vectors match signature framing and every event hash', () => {
  const vector = JSON.parse(load('wire-vectors.json'));
  const record = load(vector.fixture);
  const envelope = JSON.parse(record);
  const payloadBytes = Buffer.from(envelope.payload, 'base64');
  const payload = JSON.parse(payloadBytes);
  const header = Buffer.from(payload.header, 'base64');
  assert.equal(sha256(record), vector.certificateSHA256);
  assert.equal(sha256(payloadBytes), vector.payloadSHA256);
  assert.equal(
    sha256(Buffer.concat([Buffer.from('ExtraProof.Certificate.v1\0'), payloadBytes])),
    vector.signedMessageSHA256,
  );
  assert.equal(sha256(header), vector.headerSHA256);
  let previous = sha256(Buffer.concat([Buffer.from('ExtraProof.Session.v1\0'), header]));
  assert.equal(previous, vector.anchor);
  for (const event of payload.events) {
    const body = Buffer.from(event.body, 'base64');
    assert.equal(event.previousHash, previous);
    previous = sha256(
      Buffer.concat([
        Buffer.from('ExtraProof.Event.v1\0'),
        Buffer.from(previous, 'hex'),
        u64(event.sequence),
        u64(body.length),
        body,
      ]),
    );
    assert.equal(previous, vector.eventHashes[event.sequence]);
  }
  assert.equal(previous, vector.headHash);
  assert.equal(sha256(load('synthetic-document.txt')), vector.documentSHA256);
});

for (const item of JSON.parse(load('adversarial/manifest.json')).cases) {
  test('reject published negative vector: ' + item.file, () => {
    const result = verifyCertificate(load('adversarial/' + item.file));
    assert.equal(result.integrityValid, false);
    assert.equal(result.isValid, false);
  });
}

test('public API validates byte inputs, sizes and trust configuration', () => {
  const fixture = makeFixture();
  for (const options of [
    null,
    [],
    { extra: true },
    { trustedKeyIDs: ['x'] },
    { trustedKeyIDs: [fixture.envelope.keyID, fixture.envelope.keyID] },
    { fileBytes: 'text' },
  ]) {
    assert.throws(() => verifyCertificate(fixture.bytes, options), TypeError);
  }
  assert.throws(() => verifyCertificate('text'), TypeError);
  assert.throws(() => verifyCertificate(new Uint8Array(16 * 1024 * 1024 + 1)), TypeError);
  const result = verifyCertificate(new Uint8Array(fixture.bytes), {
    fileBytes: new Uint8Array(fixture.document),
  });
  assert.equal(result.isValid, true);
});

test('package verification keeps integrity, trust, privacy and policy separate', () => {
  const fixture = packageFixture();
  const result = verifyBundle(fixture.manifestBytes, fixture.bytes, fixture.document);
  assert.deepEqual(result.errors, []);
  assert.equal(result.packageIntegrity, 'valid');
  assert.equal(result.recordIntegrity, 'valid');
  assert.equal(result.documentBinding, 'matched');
  assert.equal(result.signerTrust, 'unknown');
  assert.equal(result.privacy.status, 'synthetic-only');
  assert.equal(result.observation.knownGapIndicators, 1);
  assert.equal(result.revocation.status, 'unknown');
  assert.equal(result.trustedTime, 'unavailable');
  const policy = { id: 'review', version: '1', requirePinnedKey: true, allowSynthetic: false };
  const rejected = verifyBundle(fixture.manifestBytes, fixture.bytes, fixture.document, {
    trustedKeyIDs: [fixture.envelope.keyID],
    policy,
  });
  assert.equal(rejected.signerTrust, 'pinned-key');
  assert.equal(rejected.policy, 'not-satisfied');
});

for (const [name, change] of [
  [
    'document digest',
    (value) => {
      value.document.digest = '0'.repeat(64);
    },
  ],
  [
    'record reference',
    (value) => {
      value.record.sessionID = '33333333-3333-4333-8333-333333333333';
    },
  ],
  [
    'record hash',
    (value) => {
      value.record.digest = '0'.repeat(64);
    },
  ],
  [
    'critical extension',
    (value) => {
      value.extensions.capture = {};
      value.criticalExtensions = ['capture'];
    },
  ],
  [
    'new version',
    (value) => {
      value.version = 'extraara-package/9';
    },
  ],
  [
    'unknown manifest field',
    (value) => {
      value.approved = true;
    },
  ],
]) {
  test('valid signature does not excuse an invalid package ' + name, () => {
    const fixture = packageFixture(change);
    const result = verifyBundle(fixture.manifestBytes, fixture.bytes, fixture.document);
    assert.ok(result.errors.length > 0);
    assert.equal(result.syntheticTransportEligible, false);
  });
}

test('unknown noncritical extensions block privacy admission without adding assurance', () => {
  const fixture = packageFixture((value) => {
    value.extensions.capture = { human: true };
  });
  const result = verifyBundle(fixture.manifestBytes, fixture.bytes, fixture.document);
  assert.deepEqual(result.errors, []);
  assert.equal(result.privacy.status, 'blocked');
  assert.equal(result.observation.textOrigin, 'unknown');
  assert.equal(result.observation.inputAttestation, 'none');
});

test('missing and substituted package documents remain distinct', () => {
  const fixture = packageFixture();
  assert.equal(verifyBundle(fixture.manifestBytes, fixture.bytes).documentBinding, 'not-checked');
  const result = verifyBundle(fixture.manifestBytes, fixture.bytes, Buffer.from('replacement'));
  assert.equal(result.documentBinding, 'mismatched');
  assert.ok(result.errors.includes('E_DOCUMENT_HASH'));
});

test('package signatures cannot be replaced with record signatures', () => {
  const fixture = packageFixture();
  const envelope = JSON.parse(fixture.manifestBytes);
  envelope.signature = fixture.envelope.signature;
  const result = verifyBundle(
    Buffer.from(JSON.stringify(envelope)),
    fixture.bytes,
    fixture.document,
  );
  assert.ok(result.errors.includes('E_PACKAGE_SIGNATURE'));
});
