const fail = (message) => {
  throw new Error(`Word evidence: ${message}.`);
};
const check = (condition, message) => {
  if (!condition) fail(message);
};
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const uint = (value) => Number.isSafeInteger(value) && value >= 0;
const hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const bounded = (value, min, max) =>
  typeof value === 'string' && Buffer.byteLength(value) >= min && Buffer.byteLength(value) <= max;
const keys = (metadata, expected) =>
  check(
    record(metadata) &&
      Object.keys(metadata).length === expected.length &&
      expected.every((key) => Object.hasOwn(metadata, key)),
    'unexpected or missing metadata fields',
  );
const counter = (value) => {
  check(
    typeof value === 'string' && uint(Number(value)) && String(Number(value)) === value,
    'noncanonical unsigned counter',
  );
  return Number(value);
};
const add = (lhs, rhs) => {
  check(rhs <= Number.MAX_SAFE_INTEGER - lhs, 'counter overflow');
  return lhs + rhs;
};

export function assessWord(observations, { binding, startedAt, endedAt }) {
  check(
    uint(startedAt) &&
      uint(endedAt) &&
      endedAt >= startedAt &&
      Array.isArray(observations) &&
      observations.length >= 5 &&
      observations.length <= 20_000,
    'invalid bounds or event count',
  );
  let state = 'start',
    lastTime = startedAt,
    lastMono = 0n;
  let baseline = 0,
    length = 0,
    snapshots = 0,
    larger = 0,
    gaps = 0;
  let local = 0,
    remote = 0,
    unknown = 0;
  let finalHash = '',
    previousSnapshotHash = '',
    needsResumeSnapshot = false;
  for (const [index, observation] of observations.entries()) {
    check(
      record(observation) &&
        bounded(observation.kind, 1, 128) &&
        uint(observation.timestampMilliseconds) &&
        typeof observation.monotonicNanoseconds === 'string' &&
        /^(0|[1-9][0-9]{0,19})$/.test(observation.monotonicNanoseconds) &&
        record(observation.metadata) &&
        Object.keys(observation.metadata).length <= 32 &&
        Object.entries(observation.metadata).every(
          ([key, value]) => bounded(key, 1, 128) && bounded(value, 0, 2048),
        ) &&
        Buffer.byteLength(JSON.stringify(observation)) <= 16_384,
      'invalid observation fields',
    );
    const mono = BigInt(observation.monotonicNanoseconds);
    check(
      observation.timestampMilliseconds >= lastTime &&
        observation.timestampMilliseconds <= endedAt &&
        mono >= lastMono &&
        mono <= 18_446_744_073_709_551_615n,
      'event times are outside the ordered session',
    );
    lastTime = observation.timestampMilliseconds;
    lastMono = mono;
    const m = observation.metadata;
    switch (observation.kind) {
      case 'word.session.started':
        keys(m, ['schemaVersion', 'scope', 'capture', 'wordApi', 'hostVersion']);
        check(
          state === 'start' &&
            m.schemaVersion === 'extraproof.word/1' &&
            m.scope === 'body.text' &&
            m.capture === 'snapshot+paragraph-events' &&
            m.wordApi === '1.6' &&
            bounded(m.hostVersion, 1, 256) &&
            !/[\p{Cc}\p{Cf}]/u.test(m.hostVersion),
          'invalid start or capture scope',
        );
        state = 'baseline';
        break;
      case 'word.snapshot': {
        keys(m, [
          'sha256',
          'utf16Length',
          'paragraphCount',
          'reason',
          'insertedEstimate',
          'deletedEstimate',
          'source',
          'basis',
        ]);
        check(
          ['baseline', 'active'].includes(state) &&
            hex(m.sha256) &&
            ['local', 'remote', 'mixed', 'unknown'].includes(m.source) &&
            m.basis === 'common-prefix-suffix',
          'invalid snapshot scope, state or source',
        );
        const newLength = counter(m.utf16Length),
          paragraphs = counter(m.paragraphCount);
        const inserted = counter(m.insertedEstimate),
          deleted = counter(m.deletedEstimate);
        check(newLength <= 8_000_000 && paragraphs <= 100_000, 'snapshot exceeds capture limits');
        if (state === 'baseline') {
          check(
            m.reason === 'baseline' && inserted === 0 && deleted === 0,
            'first snapshot must be an unchanged baseline',
          );
          baseline = newLength;
          state = 'active';
        } else {
          check(
            ['change', 'poll', 'resume', 'final'].includes(m.reason) &&
              deleted <= length &&
              inserted <= newLength &&
              length - deleted === newLength - inserted &&
              (inserted === 0 && deleted === 0) === (m.sha256 === previousSnapshotHash) &&
              (!needsResumeSnapshot || m.reason === 'resume'),
            'snapshot delta or order is inconsistent',
          );
          if (m.reason === 'resume') {
            check(needsResumeSnapshot, 'resume snapshot without resume');
            needsResumeSnapshot = false;
          }
          if (inserted >= 80 || deleted >= 80) larger++;
          if (m.reason === 'final') {
            state = 'final';
            finalHash = m.sha256;
          }
        }
        length = newLength;
        snapshots++;
        previousSnapshotHash = m.sha256;
        break;
      }
      case 'word.event': {
        keys(m, ['type', 'source', 'count']);
        check(
          state === 'active' &&
            !needsResumeSnapshot &&
            ['added', 'changed', 'deleted'].includes(m.type),
          'invalid paragraph event',
        );
        const count = counter(m.count);
        check(count > 0, 'empty paragraph event');
        if (m.source === 'local') local = add(local, count);
        else if (m.source === 'remote') remote = add(remote, count);
        else if (m.source === 'unknown') unknown = add(unknown, count);
        else fail('unsupported paragraph source');
        break;
      }
      case 'word.coverage.gap':
        keys(m, ['reason']);
        check(
          ['active', 'paused', 'baseline'].includes(state) &&
            [
              'pause',
              'heartbeat-timeout',
              'reload',
              'snapshot-error',
              'visibility',
              'transport',
              'closing',
              'export-race',
            ].includes(m.reason),
          'invalid gap',
        );
        gaps++;
        break;
      case 'word.session.paused': {
        keys(m, []);
        check(state === 'active' && !needsResumeSnapshot, 'pause outside active capture');
        const prior = observations[index - 1];
        if (prior?.kind !== 'word.coverage.gap' || prior?.metadata.reason !== 'pause') gaps++;
        state = 'paused';
        break;
      }
      case 'word.session.resumed':
        keys(m, []);
        check(state === 'paused', 'resume without pause');
        state = 'active';
        needsResumeSnapshot = true;
        break;
      case 'word.export':
        keys(m, ['scope', 'documentSha256', 'byteCount', 'bodySha256']);
        check(
          state === 'final' &&
            m.scope === 'docx-bytes' &&
            m.bodySha256 === finalHash &&
            record(binding) &&
            m.documentSha256 === binding.sha256 &&
            counter(m.byteCount) === binding.byteCount,
          'export does not match final snapshot or bound document bytes',
        );
        state = 'exported';
        break;
      case 'word.session.ended':
        keys(m, []);
        check(state === 'exported', 'end before export');
        state = 'ended';
        break;
      default:
        fail('unsupported event kind');
    }
  }
  check(state === 'ended', 'session has no complete export');
  return {
    schemaVersion: 'extraproof.word/1',
    scope: 'body.text',
    textOrigin: 'unknown',
    baselineUTF16Length: baseline,
    finalUTF16Length: length,
    snapshotCount: snapshots,
    largerChangeCount: larger,
    localEventCount: local,
    remoteEventCount: remote,
    unknownEventCount: unknown,
    gapCount: gaps,
    finalBodySHA256: finalHash,
  };
}
