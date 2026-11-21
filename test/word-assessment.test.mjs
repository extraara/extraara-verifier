import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCertificate } from '../src/verifier.mjs';
import { assessWord } from '../src/word-assessment.mjs';
import { makeFixture, digest } from './fixture.mjs';

const swiftBytes = readFileSync(
  new URL('../fixtures/synthetic-word-certificate.json', import.meta.url),
);
const document = readFileSync(new URL('../fixtures/synthetic-word-document.docx', import.meta.url));
const swiftEnvelope = JSON.parse(swiftBytes);
const swiftPayload = JSON.parse(Buffer.from(swiftEnvelope.payload, 'base64'));
const swiftHeader = JSON.parse(Buffer.from(swiftPayload.header, 'base64'));
const swiftEvents = swiftPayload.events.map((event) =>
  JSON.parse(Buffer.from(event.body, 'base64')),
);
const baselineText = 'Synthetischer Word-Test. Kein echter Schreibnachweis.';
const snapshot = (text, reason, inserted = 0, deleted = 0) => ({
  sha256: digest(Buffer.from(text)),
  utf16Length: String(text.length),
  paragraphCount: '1',
  reason,
  insertedEstimate: String(inserted),
  deletedEstimate: String(deleted),
  source: 'unknown',
  basis: 'common-prefix-suffix',
});

function richEvents() {
  const larger = `${baselineText}${'x'.repeat(100)}`;
  const pairs = [
    ['word.session.started', swiftEvents[0].metadata],
    ['word.snapshot', snapshot(baselineText, 'baseline')],
    ['word.event', { type: 'changed', source: 'local', count: '2' }],
    ['word.snapshot', snapshot(larger, 'change', 100)],
    ['word.coverage.gap', { reason: 'pause' }],
    ['word.session.paused', {}],
    ['word.session.resumed', {}],
    ['word.snapshot', snapshot(larger, 'resume')],
    ['word.event', { type: 'changed', source: 'remote', count: '1' }],
    ['word.snapshot', snapshot(baselineText, 'final', 0, 100)],
    ['word.export', swiftEvents[3].metadata],
    ['word.session.ended', {}],
  ];
  return pairs.map(([kind, metadata], index) => ({
    kind,
    metadata: structuredClone(metadata),
    timestampMilliseconds: swiftHeader.startedAtMilliseconds + index * 30_000,
    monotonicNanoseconds: String(index * 30_000_000_000),
  }));
}

function fixture({
  events = richEvents(),
  changeEvents,
  alterHeader,
  alterPayload,
  alterEnvelope,
} = {}) {
  events = structuredClone(events);
  changeEvents?.(events);
  return makeFixture({
    observations: events,
    bound: false,
    alterHeader: (header) => {
      Object.assign(header, swiftHeader);
      alterHeader?.(header);
    },
    alterPayload: (payload) => {
      payload.completion.fileBinding = structuredClone(swiftPayload.completion.fileBinding);
      alterPayload?.(payload);
    },
    alterEnvelope,
  });
}
function changeMetadata(events, kind, key, value) {
  events.find((event) => event.kind === kind).metadata[key] = value;
}

test('Swift-signed Word fixture verifies with identical cross-language assessment and DOCX bytes', () => {
  const report = verifyCertificate(swiftBytes, { fileBytes: document });
  assert.equal(report.isValid, true, report.errors.join('; '));
  assert.equal(report.fileStatus, 'matched');
  assert.equal(report.keyID, swiftEnvelope.keyID);
  assert.equal(report.writingAssessment, undefined);
  assert.deepEqual(report.wordAssessment, {
    schemaVersion: 'extraproof.word/1',
    scope: 'body.text',
    textOrigin: 'unknown',
    baselineUTF16Length: 53,
    finalUTF16Length: 53,
    snapshotCount: 2,
    largerChangeCount: 0,
    localEventCount: 0,
    remoteEventCount: 0,
    unknownEventCount: 0,
    gapCount: 0,
    finalBodySHA256: 'ae5d9cbcdb71be41bd18deebef70944c51ca9f0871bae6df7c788ae7685117d1',
  });
  assert.equal(
    report.warnings.some((warning) => warning.includes('Paste-shortcut detection')),
    false,
  );
});

test('Word changes, waits and pause/resume retain cumulative gaps and source hints', () => {
  const report = verifyCertificate(fixture().bytes, { fileBytes: document });
  assert.equal(report.isValid, true, report.errors.join('; '));
  assert.equal(report.wordAssessment.snapshotCount, 4);
  assert.equal(report.wordAssessment.largerChangeCount, 2);
  assert.equal(report.wordAssessment.localEventCount, 2);
  assert.equal(report.wordAssessment.remoteEventCount, 1);
  assert.equal(report.wordAssessment.gapCount, 1);
  assert.equal(report.wordAssessment.textOrigin, 'unknown');
  assert.equal(report.wordAssessment.finalUTF16Length, 53);
  assert.equal(
    report.warnings.some((warning) => warning.includes('gaps were recorded')),
    true,
  );
});

test('Word pause itself counts as a gap even if its explicit gap marker is omitted', () => {
  const report = verifyCertificate(
    fixture({ events: richEvents().filter((event) => event.kind !== 'word.coverage.gap') }).bytes,
  );
  assert.equal(report.isValid, true);
  assert.equal(report.wordAssessment.gapCount, 1);
});

test('valid signatures cannot authenticate unsupported Word scopes, sources or counters', () => {
  for (const [kind, key, value] of [
    ['word.session.started', 'schemaVersion', 'extraproof.word/2'],
    ['word.session.started', 'scope', 'whole-document'],
    ['word.session.started', 'wordApi', '1.5'],
    ['word.session.started', 'hostVersion', '16.1\u0000hidden'],
    ['word.snapshot', 'source', 'human'],
    ['word.event', 'source', 'verified-person'],
    ['word.snapshot', 'utf16Length', '053'],
    ['word.snapshot', 'utf16Length', '8000001'],
    ['word.snapshot', 'paragraphCount', '100001'],
    ['word.event', 'count', '9007199254740992'],
    ['word.event', 'count', '0'],
    ['word.snapshot', 'basis', 'AI-detector'],
    ['word.export', 'scope', 'body.text'],
    ['word.coverage.gap', 'reason', 'cleared'],
    ['word.event', 'unexpected', 'value'],
  ]) {
    const report = verifyCertificate(
      fixture({ changeEvents: (events) => changeMetadata(events, kind, key, value) }).bytes,
    );
    assert.equal(report.integrityValid, false, `${kind}.${key}`);
    assert.equal(report.wordAssessment, undefined, `${kind}.${key}`);
    assert.equal(report.writingAssessment, undefined);
  }
});

test('Word state machine rejects incomplete, misordered and interrupted captures', () => {
  const cases = [
    { events: richEvents().slice(0, -1) },
    { events: richEvents().filter((event) => event.kind !== 'word.session.paused') },
    { events: richEvents().filter((event) => event.metadata.reason !== 'resume') },
    { changeEvents: (events) => events.push(structuredClone(events.at(-1))) },
    { changeEvents: (events) => changeMetadata(events, 'word.snapshot', 'reason', 'change') },
    {
      alterHeader: (header) => {
        header.targetBundleID = 'example.writer';
      },
    },
    {
      alterHeader: (header) => {
        header.mode = 'sealedObservation';
      },
    },
    {
      alterPayload: (payload) => {
        payload.completion.status = 'interrupted';
      },
    },
    {
      alterPayload: (payload) => {
        payload.completion.endedAtMilliseconds = swiftHeader.startedAtMilliseconds;
      },
    },
    {
      changeEvents: (events) => {
        events[2].timestampMilliseconds = events[1].timestampMilliseconds - 1;
      },
    },
  ];
  for (const options of cases) {
    const report = verifyCertificate(fixture(options).bytes);
    assert.equal(report.isValid, false);
    assert.equal(report.wordAssessment, undefined);
  }
});

test('Word verification rejects inconsistent deltas, snapshot hashes and export claims', () => {
  const mutations = [
    (events) => changeMetadata(events, 'word.snapshot', 'insertedEstimate', '1'),
    (events) => {
      events.find((event) => event.metadata.reason === 'resume').metadata.sha256 = '0'.repeat(64);
    },
    (events) => {
      events.find((event) => event.metadata.reason === 'change').metadata.insertedEstimate = '99';
    },
    (events) => changeMetadata(events, 'word.export', 'bodySha256', '0'.repeat(64)),
    (events) => changeMetadata(events, 'word.export', 'documentSha256', '0'.repeat(64)),
    (events) => changeMetadata(events, 'word.export', 'byteCount', '1'),
  ];
  for (const changeEvents of mutations) {
    const report = verifyCertificate(fixture({ changeEvents }).bytes);
    assert.equal(report.isValid, false);
    assert.equal(report.wordAssessment, undefined);
  }
});

test('Word schema detection cannot be bypassed by omitting the recorder prefix or Word events', () => {
  const valid = verifyCertificate(
    fixture({
      alterHeader: (header) => {
        header.recorderVersion = '1.2.0';
      },
    }).bytes,
  );
  assert.equal(valid.isValid, true);
  assert.ok(valid.wordAssessment);
  const invalid = verifyCertificate(
    fixture({
      changeEvents: (events) => {
        events.forEach((event) => {
          event.kind = 'input.summary';
        });
      },
    }).bytes,
  );
  assert.equal(invalid.integrityValid, false);
  assert.equal(invalid.wordAssessment, undefined);
});

test('Word assessment appears only after valid signature and complete chain validation', () => {
  for (const options of [
    {
      alterEnvelope: (envelope) => {
        envelope.signature = Buffer.alloc(64).toString('base64');
      },
    },
    {
      alterPayload: (payload) => {
        payload.headHash = '0'.repeat(64);
      },
    },
    {
      alterPayload: (payload) => {
        payload.events[1].hash = '0'.repeat(64);
      },
    },
  ]) {
    const report = verifyCertificate(fixture(options).bytes);
    assert.equal(report.integrityValid, false);
    assert.equal(report.wordAssessment, undefined);
    assert.equal(report.writingAssessment, undefined);
  }
  const mismatch = verifyCertificate(swiftBytes, { fileBytes: Buffer.from('wrong') });
  assert.equal(mismatch.isValid, false);
  assert.equal(mismatch.fileStatus, 'mismatched');
  assert.ok(mismatch.wordAssessment);
});

test('Word assessment bounds event counts, timestamps and accumulated source counters', () => {
  const options = {
    binding: swiftPayload.completion.fileBinding,
    startedAt: swiftHeader.startedAtMilliseconds,
    endedAt: Number.MAX_SAFE_INTEGER,
  };
  assert.throws(() => assessWord(Array(20_001).fill(swiftEvents[0]), options), /event count/);
  assert.throws(() => assessWord(richEvents(), { ...options, startedAt: -1 }), /bounds/);
  const events = richEvents();
  changeMetadata(events, 'word.event', 'count', String(Number.MAX_SAFE_INTEGER));
  const another = structuredClone(events[2]);
  another.timestampMilliseconds = events[3].timestampMilliseconds;
  another.monotonicNanoseconds = events[3].monotonicNanoseconds;
  events.splice(3, 0, another);
  assert.throws(() => assessWord(events, options), /overflow/);
});
