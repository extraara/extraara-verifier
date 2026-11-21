import { assessAccessibility } from './accessibility-assessment.mjs';

export function assessWriting(observations) {
  const result = {
    trackingSupported: false,
    trackingComplete: false,
    pasteShortcutCount: 0,
    keyboardEventCount: 0,
    timingMatchCount: 0,
    gapCount: 0,
    unknownSourceIndicatorCount: 0,
    malformedEvidence: false,
    textOrigin: 'unknown',
  };
  let complete = true,
    segmentSupported = false;
  const count = (raw) => {
    if (raw === undefined) return 0;
    if (
      typeof raw !== 'string' ||
      !Number.isSafeInteger(Number(raw)) ||
      Number(raw) < 0 ||
      String(Number(raw)) !== raw
    ) {
      result.malformedEvidence = true;
      return 0;
    }
    return Number(raw);
  };
  const add = (key, value) => {
    if (value > Number.MAX_SAFE_INTEGER - result[key]) {
      result.malformedEvidence = true;
      result[key] = Number.MAX_SAFE_INTEGER;
    } else result[key] += value;
  };
  for (const observation of observations) {
    const m = observation.metadata;
    switch (observation.kind) {
      case 'telemetry_started': {
        const versionSupported = m.inputEvidenceVersion === '1';
        result.trackingSupported ||= versionSupported;
        segmentSupported = versionSupported && m.pasteDetection === 'command_v_keycode_hint';
        if (!segmentSupported) complete = false;
        break;
      }
      case 'telemetry_stopped':
        segmentSupported = false;
        break;
      case 'input_activity': {
        if (
          !segmentSupported ||
          m.inputEvidenceVersion !== '1' ||
          m.pasteDetection !== 'command_v_keycode_hint'
        )
          complete = false;
        const paste = count(m.pasteShortcutCount),
          keyboard = count(m.quartzKeyDown);
        if (paste > keyboard) result.malformedEvidence = true;
        add('pasteShortcutCount', paste);
        add('keyboardEventCount', keyboard);
        add('timingMatchCount', count(m.timingCorrelated));
        add('unknownSourceIndicatorCount', count(m.privateSourceStateIndicators));
        add('unknownSourceIndicatorCount', count(m.quartzWithoutTimingMatch));
        break;
      }
      case 'observation_gap':
        if (m.state !== 'end') add('gapCount', 1);
        break;
      case 'clock_discontinuity':
      case 'session.recovered':
        add('gapCount', 1);
        break;
      case 'capture_scope_changed':
        if (m.targetFocusedAndEligible === 'false') add('gapCount', 1);
        break;
    }
  }
  result.trackingComplete = result.trackingSupported && complete;
  const accessibility = assessAccessibility(observations);
  if (accessibility !== undefined) {
    result.accessibility = accessibility;
    result.malformedEvidence ||= accessibility.malformedEvidence;
  }
  return result;
}
