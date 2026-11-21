import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCertificate } from '../src/verifier.mjs';
import { parseStrictJSON } from '../src/json.mjs';
import { makeFixture } from './fixture.mjs';

test('independent Node certificate verifies and trust/document are separate', () => {
  const f = makeFixture();
  const report = verifyCertificate(f.bytes);
  assert.equal(report.isValid, true);
  assert.equal(report.signerTrusted, false);
  assert.equal(report.fileStatus, 'notChecked');
  assert.equal(report.synthetic, true);
  assert.equal(report.eventCount, 3);
  const checked = verifyCertificate(f.bytes, {
    fileBytes: f.document,
    trustedKeyIDs: [f.envelope.keyID],
  });
  assert.equal(checked.fileStatus, 'matched');
  assert.equal(checked.signerTrusted, true);
});
test('document substitution fails independently of valid signature', () => {
  const report = verifyCertificate(makeFixture().bytes, { fileBytes: Buffer.from('different') });
  assert.equal(report.integrityValid, true);
  assert.equal(report.isValid, false);
  assert.equal(report.fileStatus, 'mismatched');
});
test('unbound document and empty events are never implied proof', () => {
  const report = verifyCertificate(makeFixture({ bound: false, count: 0 }).bytes);
  assert.equal(report.isValid, true);
  assert.equal(report.fileStatus, 'notBound');
  assert.ok(report.warnings.some((x) => x.includes('No observations')));
});
for (const [name, options] of [
  [
    'signature substitution',
    {
      alterEnvelope: (e) => {
        e.signature = Buffer.alloc(64).toString('base64');
      },
    },
  ],
  [
    'key substitution',
    {
      alterEnvelope: (e) => {
        e.publicKey = Buffer.alloc(32).toString('base64');
      },
    },
  ],
  [
    'event removal even after attacker re-signs',
    {
      alterPayload: (p) => {
        p.events.splice(1, 1);
      },
    },
  ],
  [
    'chain head substitution',
    {
      alterPayload: (p) => {
        p.headHash = '0'.repeat(64);
      },
    },
  ],
  [
    'sequence reorder',
    {
      alterPayload: (p) => {
        p.events.reverse();
      },
    },
  ],
  [
    'assurance inflation',
    {
      alterHeader: (h) => {
        h.assurance = 'hardwareAttested';
      },
    },
  ],
  [
    'version downgrade',
    {
      alterEnvelope: (e) => {
        e.schemaVersion = 'extraproof/0';
      },
    },
  ],
  [
    'duplicate signed payload key',
    { rawPayload: (p) => JSON.stringify(p).replace('"events":', '"events":[],"events":') },
  ],
  [
    'unsafe timestamp',
    {
      alterHeader: (h) => {
        h.startedAtMilliseconds = Number.MAX_SAFE_INTEGER + 1;
      },
    },
  ],
  [
    'overlong recorder',
    {
      alterHeader: (h) => {
        h.recorderVersion = 'a'.repeat(129);
      },
    },
  ],
  [
    'false mode',
    {
      alterHeader: (h) => {
        h.mode = 'sealedEnforced';
      },
    },
  ],
  [
    'recording certificate',
    {
      alterPayload: (p) => {
        p.completion.status = 'recording';
      },
    },
  ],
])
  test(`reject ${name}`, () =>
    assert.equal(verifyCertificate(makeFixture(options).bytes).isValid, false));

test('strict JSON rejects duplicate escaped key and unsafe numeric forms', () => {
  for (const input of [
    '{"a":1,"\\u0061":2}',
    '{"n":1.0}',
    '{"n":-0}',
    '{"n":1e0}',
    '{"n":9007199254740992}',
    '['.repeat(34) + '0' + ']'.repeat(34),
  ])
    assert.throws(() => parseStrictJSON(input));
  assert.equal(parseStrictJSON('{"__proto__":"inert"}').__proto__, 'inert');
});
