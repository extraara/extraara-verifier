const epoch = '8785CB27-EC38-4A69-B5B6-FA0D778A2937';
export const axEvent = (kind, metadata = {}) => ({
  kind,
  metadata,
  timestampMilliseconds: 1000,
  monotonicNanoseconds: '1000000',
});
export const axStatus = (status = 'observing', version = '1') =>
  axEvent('accessibility_status', { axEvidenceVersion: version, status, reason: 'test_status' });
export const axBaseline = (utf16Length = '10', overrides = {}) =>
  axEvent('accessibility_text_observation', {
    axEvidenceVersion: '1',
    scope: 'focused_text_control',
    sampleType: 'baseline',
    fieldEpoch: epoch,
    utf16Length,
    ...overrides,
  });
export const axChange = (overrides = {}) =>
  axEvent('accessibility_text_observation', {
    axEvidenceVersion: '1',
    scope: 'focused_text_control',
    sampleType: 'change',
    fieldEpoch: epoch,
    utf16Length: '110',
    previousUTF16Length: '10',
    insertedEstimate: '100',
    deletedEstimate: '0',
    intervalMilliseconds: '1000',
    keyboardEventCount: '1',
    keyboardCoverage: 'available',
    ...overrides,
  });

export const accessibilityCases = [
  [
    axStatus(),
    axBaseline(),
    axChange(),
    axChange({
      previousUTF16Length: '110',
      utf16Length: '120',
      insertedEstimate: '10',
      keyboardEventCount: '10',
    }),
  ],
  [
    axStatus(),
    axBaseline(),
    axChange(),
    axStatus('suspended'),
    axStatus(),
    axBaseline(),
    axChange(),
  ],
  [axStatus('observing', '2')],
  ...['unavailable', 'disabled'].map((status) => [axStatus(status)]),
  ...['keyboardEventCount', 'utf16Length', 'intervalMilliseconds'].flatMap((key) =>
    ['01', '-1', '1.0', '+1', '1\n', '١', '9007199254740992', '9'.repeat(100)].map((value) => [
      axStatus(),
      axBaseline(),
      axChange({ [key]: value }),
    ]),
  ),
  ...[
    { intervalMilliseconds: '0' },
    { intervalMilliseconds: '5001' },
    { previousUTF16Length: '11' },
    { insertedEstimate: '101' },
    { deletedEstimate: '11' },
    { keyboardCoverage: 'other' },
    { utf16Length: '100001' },
    { fieldEpoch: 'invalid' },
    { scope: 'document' },
    { rawText: 'unexpected' },
  ].map((fields) => [axStatus(), axBaseline(), axChange(fields)]),
  ...[
    { keyboardEventCount: '5', intervalMilliseconds: '2500' },
    { keyboardEventCount: '6' },
    { keyboardCoverage: 'unavailable' },
    { intervalMilliseconds: '2501' },
    { intervalMilliseconds: '5000' },
    { insertedEstimate: '79', utf16Length: '89' },
  ].map((fields) => [axStatus(), axBaseline(), axChange(fields)]),
  ...[
    axStatus('unavailable'),
    axStatus('suspended'),
    axStatus('disabled'),
    axStatus('observing', '2'),
    axEvent('telemetry_stopped'),
    axEvent('telemetry_started'),
  ].map((interruption) => [
    axStatus(),
    axBaseline(),
    axChange(),
    interruption,
    axStatus(),
    axChange({ previousUTF16Length: '110', utf16Length: '210' }),
  ]),
  [
    axStatus(),
    axBaseline('100'),
    axChange({
      fieldEpoch: epoch.toLowerCase(),
      previousUTF16Length: '100',
      utf16Length: '10',
      insertedEstimate: '0',
      deletedEstimate: '90',
    }),
  ],
  [
    axStatus(),
    axBaseline('100000'),
    axChange({
      previousUTF16Length: '100000',
      utf16Length: '100000',
      insertedEstimate: '100000',
      deletedEstimate: '100000',
      keyboardEventCount: '9007199254740991',
    }),
  ],
  [axBaseline()],
  [axStatus(), axChange()],
  ...['100', '179'].map((utf16Length) => [
    axStatus(),
    axBaseline('100'),
    axChange({
      previousUTF16Length: '100',
      utf16Length,
      insertedEstimate: utf16Length,
      deletedEstimate: '100',
    }),
  ]),
];
