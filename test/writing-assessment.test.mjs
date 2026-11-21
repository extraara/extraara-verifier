import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWriting } from '../src/writing-assessment.mjs';
import { verifyCertificate } from '../src/verifier.mjs';
import { makeFixture } from './fixture.mjs';
import { writingCases } from './writing-fixtures.mjs';

const support = { inputEvidenceVersion: '1', pasteDetection: 'command_v_keycode_hint' };
const event = (kind, metadata = {}, time = 1000) => ({
  kind,
  metadata,
  timestampMilliseconds: time,
  monotonicNanoseconds: String(time * 1_000_000),
});
const start = () => event('telemetry_started', support);
const input = (metadata, time) => event('input_activity', { ...support, ...metadata }, time);

test('paste, one hour wait and further typing retains the hint', () => {
  const result = verifyCertificate(makeFixture({ observations: writingCases[0] }).bytes);
  assert.equal(result.isValid, true);
  assert.equal(result.writingAssessment.pasteShortcutCount, 1);
  assert.equal(result.writingAssessment.keyboardEventCount, 301);
  assert.equal(result.writingAssessment.textOrigin, 'unknown');
});
test('pause and supported restart preserve hints and gap history', () => {
  const result = assessWriting(writingCases[1]);
  assert.equal(result.pasteShortcutCount, 1);
  assert.equal(result.gapCount, 1);
  assert.equal(result.trackingComplete, true);
  assert.equal(result.textOrigin, 'unknown');
});
test('legacy and mixed recorders never become fully assessed', () => {
  assert.equal(assessWriting(writingCases[2]).trackingSupported, false);
  const mixed = assessWriting(writingCases[3]);
  assert.equal(mixed.trackingSupported, true);
  assert.equal(mixed.trackingComplete, false);
  assert.equal(mixed.pasteShortcutCount, 1);
});
test('malformed and overflow counters flag incomplete numeric evidence', () => {
  const overflow = assessWriting(writingCases[4]);
  assert.equal(overflow.keyboardEventCount, Number.MAX_SAFE_INTEGER);
  assert.equal(overflow.malformedEvidence, true);
  const invalid = assessWriting(writingCases[5]);
  assert.equal(invalid.malformedEvidence, true);
  assert.equal(invalid.pasteShortcutCount, 2);
});
test('focus, recovery and clock gaps cannot be cleared by later input', () => {
  const result = assessWriting([...writingCases[6], input({ quartzKeyDown: '10' }, 5000)]);
  assert.equal(result.gapCount, 3);
});
test('overlapping source indicators are never unique text or automation counts', () => {
  const result = assessWriting(writingCases[7]);
  assert.equal(result.unknownSourceIndicatorCount, 3);
  assert.equal(result.textOrigin, 'unknown');
});
test('no hints, supported input and empty evidence never establish text origin', () => {
  for (const observations of writingCases)
    assert.equal(assessWriting(observations).textOrigin, 'unknown');
});
test('failed signature must not expose authenticated writing assessment', () => {
  const fixture = makeFixture({
    observations: writingCases[0],
    alterEnvelope: (envelope) => {
      envelope.signature = Buffer.alloc(64).toString('base64');
    },
  });
  const result = verifyCertificate(fixture.bytes);
  assert.equal(result.integrityValid, false);
  assert.equal(result.writingAssessment, undefined);
});
