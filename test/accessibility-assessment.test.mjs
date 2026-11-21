import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAccessibility } from '../src/accessibility-assessment.mjs';
import { assessWriting } from '../src/writing-assessment.mjs';
import { verifyCertificate } from '../src/verifier.mjs';
import { makeFixture } from './fixture.mjs';
import {
  accessibilityCases,
  axEvent,
  axStatus,
  axBaseline,
  axChange,
} from './accessibility-fixtures.mjs';

test('legacy evidence has no accessibility report', () => {
  assert.equal(assessAccessibility([]), undefined);
  assert.equal(assessWriting([axEvent('telemetry_started')]).accessibility, undefined);
});
test('sampled growth survives waiting, later typing and new baselines', () => {
  const result = assessAccessibility(accessibilityCases[0]);
  assert.equal(result.trackingComplete, true);
  assert.equal(result.changeCount, 2);
  assert.equal(result.largeChangeCount, 1);
  assert.equal(result.lowKeyboardGrowthCount, 1);
  const resumed = assessAccessibility(accessibilityCases[1]);
  assert.equal(resumed.lowKeyboardGrowthCount, 2);
  assert.equal(resumed.unavailableCount, 1);
  assert.equal(resumed.trackingComplete, false);
  assert.equal(resumed.malformedEvidence, false);
});
test('unknown versions are incomplete not success', () => {
  const result = assessAccessibility(accessibilityCases[2]);
  assert.equal(result.trackingSupported, false);
  assert.equal(result.trackingComplete, false);
  assert.equal(result.malformedEvidence, false);
  assert.equal(result.baselineCount, 0);
});
test('keyboard availability and bounded interval prevent speculative low-keyboard inference', () => {
  for (const fields of [
    { keyboardEventCount: '6' },
    { keyboardCoverage: 'unavailable' },
    { intervalMilliseconds: '2501' },
    { intervalMilliseconds: '5000' },
  ]) {
    const result = assessAccessibility([axStatus(), axBaseline(), axChange(fields)]);
    assert.equal(result.largeChangeCount, 1);
    assert.equal(result.lowKeyboardGrowthCount, 0);
    assert.equal(result.malformedEvidence, false);
  }
  assert.equal(
    assessAccessibility([
      axStatus(),
      axBaseline(),
      axChange({ keyboardEventCount: '5', intervalMilliseconds: '2500' }),
    ]).lowKeyboardGrowthCount,
    1,
  );
});
test('canonical bounded numeric strings, not Number coercion, are required', () => {
  for (const key of [
    'utf16Length',
    'previousUTF16Length',
    'insertedEstimate',
    'deletedEstimate',
    'intervalMilliseconds',
    'keyboardEventCount',
  ]) {
    for (const value of [
      '-1',
      '01',
      '+1',
      '1.0',
      '',
      ' 1',
      '1\n',
      '١',
      '9007199254740992',
      '9'.repeat(100),
    ]) {
      const result = assessAccessibility([
        axStatus(),
        axBaseline(),
        axChange(),
        axChange({ [key]: value }),
      ]);
      assert.equal(result.malformedEvidence, true, `${key}: ${value}`);
      assert.equal(result.changeCount, 1);
      assert.equal(result.trackingComplete, false);
    }
  }
});
test('interruptions, starts and unknown versions invalidate previous field comparisons', () => {
  for (const interruption of [
    axStatus('unavailable'),
    axStatus('suspended'),
    axStatus('disabled'),
    axStatus('observing', '2'),
    axEvent('telemetry_stopped'),
    axEvent('telemetry_started'),
  ]) {
    const result = assessAccessibility([
      axStatus(),
      axBaseline(),
      axChange(),
      interruption,
      axStatus(),
      axChange({ previousUTF16Length: '110', utf16Length: '210' }),
    ]);
    assert.equal(result.malformedEvidence, true);
    assert.equal(result.changeCount, 1);
    assert.equal(result.lowKeyboardGrowthCount, 1);
  }
});
test('impossible changes, mismatched scopes and epochs cannot be counted', () => {
  for (const fields of [
    { intervalMilliseconds: '0' },
    { intervalMilliseconds: '5001' },
    { previousUTF16Length: '11' },
    { insertedEstimate: '101' },
    { deletedEstimate: '11' },
    { utf16Length: '100001' },
    { fieldEpoch: 'invalid' },
    { fieldEpoch: '8985cb27-ec38-4a69-b5b6-fa0d778a2937' },
    { scope: 'document' },
    { rawText: 'private' },
    { keyboardCoverage: 'unknown' },
  ]) {
    const result = assessAccessibility([axStatus(), axBaseline(), axChange(fields)]);
    assert.equal(result.malformedEvidence, true, JSON.stringify(fields));
    assert.equal(result.changeCount, 0);
  }
  assert.equal(assessAccessibility([axBaseline()]).malformedEvidence, true);
  assert.equal(assessAccessibility([axStatus(), axChange()]).malformedEvidence, true);
  assert.equal(
    assessAccessibility([axStatus(), axBaseline('10', { textHash: 'unexpected' })])
      .malformedEvidence,
    true,
  );
});
test('independent verifier derives malformed signed evidence only after signature validation', () => {
  const observations = [axStatus(), axBaseline(), axChange({ insertedEstimate: '101' })];
  const valid = verifyCertificate(makeFixture({ observations }).bytes);
  assert.equal(valid.integrityValid, true);
  assert.equal(valid.writingAssessment.accessibility.malformedEvidence, true);
  assert.equal(valid.writingAssessment.malformedEvidence, true);
  assert.equal(valid.writingAssessment.textOrigin, 'unknown');
  const damaged = verifyCertificate(
    makeFixture({
      observations,
      alterEnvelope: (envelope) => {
        envelope.signature = Buffer.alloc(64).toString('base64');
      },
    }).bytes,
  );
  assert.equal(damaged.integrityValid, false);
  assert.equal(damaged.writingAssessment, undefined);
});
test('all signed scenarios retain unknown text origin and encodable assessments', () => {
  for (const observations of accessibilityCases) {
    const result = verifyCertificate(makeFixture({ observations }).bytes);
    assert.equal(result.integrityValid, true);
    assert.equal(result.writingAssessment.textOrigin, 'unknown');
    assert.deepEqual(
      JSON.parse(JSON.stringify(result.writingAssessment)),
      assessWriting(observations),
    );
  }
});
test('large replacements with less than 80 net growth cannot be called low-keyboard growth', () => {
  for (const utf16Length of ['100', '179']) {
    const result = assessAccessibility([
      axStatus(),
      axBaseline('100'),
      axChange({
        previousUTF16Length: '100',
        utf16Length,
        insertedEstimate: utf16Length,
        deletedEstimate: '100',
      }),
    ]);
    assert.equal(result.largeChangeCount, 1);
    assert.equal(result.lowKeyboardGrowthCount, 0);
    assert.equal(result.malformedEvidence, false);
  }
});
