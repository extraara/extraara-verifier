import { accessibilityCases } from './accessibility-fixtures.mjs';

const support = { inputEvidenceVersion: '1', pasteDetection: 'command_v_keycode_hint' };
const event = (kind, metadata = {}, time = 1000) => ({
  kind,
  metadata,
  timestampMilliseconds: time,
  monotonicNanoseconds: String(time * 1_000_000),
});
const start = () => event('telemetry_started', support);
const input = (metadata, time) => event('input_activity', { ...support, ...metadata }, time);

export const writingCases = [
  [
    start(),
    input({ pasteShortcutCount: '1', quartzKeyDown: '1' }, 2000),
    input({ quartzKeyDown: '300', timingCorrelated: '300' }, 3602000),
  ],
  [
    start(),
    input({ pasteShortcutCount: '1', quartzKeyDown: '1' }, 2000),
    event('telemetry_stopped', {}, 3000),
    event('observation_gap', { state: 'begin' }, 4000),
    event('telemetry_started', support, 5000),
    event('observation_gap', { state: 'end' }, 6000),
    input({ quartzKeyDown: '10' }, 7000),
  ],
  [event('telemetry_started'), event('input_activity', { quartzKeyDown: '100' }, 2000)],
  [
    start(),
    input({ quartzKeyDown: '1', pasteShortcutCount: '1' }, 2000),
    event('telemetry_stopped', {}, 3000),
    event('telemetry_started', {}, 4000),
    event('input_activity', { quartzKeyDown: '100' }, 5000),
  ],
  [
    start(),
    input({ quartzKeyDown: '9007199254740991' }, 2000),
    input({ quartzKeyDown: '1' }, 3000),
  ],
  [
    start(),
    input(
      {
        pasteShortcutCount: '2',
        quartzKeyDown: '1',
        timingCorrelated: '01',
        privateSourceStateIndicators: '-1',
      },
      2000,
    ),
  ],
  [
    start(),
    event('capture_scope_changed', { targetFocusedAndEligible: 'false' }, 2000),
    event('session.recovered', {}, 3000),
    event('clock_discontinuity', {}, 4000),
  ],
  [
    start(),
    input(
      { quartzKeyDown: '2', quartzWithoutTimingMatch: '2', privateSourceStateIndicators: '1' },
      2000,
    ),
  ],
  [start(), input({ quartzKeyDown: '5' }, 2000)],
  [
    start(),
    input(
      {
        quartzKeyDown: '1\n',
        pasteShortcutCount: '1',
        timingCorrelated: '+1',
        quartzWithoutTimingMatch: '1e2',
      },
      2000,
    ),
  ],
  [],
  ...accessibilityCases,
];
