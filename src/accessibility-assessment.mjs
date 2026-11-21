export function assessAccessibility(observations) {
  const result = {
    trackingSupported: false,
    trackingComplete: false,
    baselineCount: 0,
    changeCount: 0,
    largeChangeCount: 0,
    lowKeyboardGrowthCount: 0,
    unavailableCount: 0,
    malformedEvidence: false,
  };
  let seen = false,
    complete = true,
    observing = false,
    epoch,
    length;
  const reset = () => {
    observing = false;
    epoch = undefined;
    length = undefined;
  };
  const invalidate = () => {
    result.malformedEvidence = true;
    complete = false;
    reset();
  };
  const count = (raw, maximum) => {
    if (typeof raw !== 'string' || raw.length > 16 || !/^(0|[1-9][0-9]*)$/.test(raw))
      return undefined;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value <= maximum ? value : undefined;
  };
  const add = (key) => {
    if (result[key] >= Number.MAX_SAFE_INTEGER) {
      result.malformedEvidence = true;
      complete = false;
    } else result[key]++;
  };
  const keysEqual = (object, allowed) =>
    Object.keys(object).length === allowed.length &&
    allowed.every((key) => Object.hasOwn(object, key));
  const baseKeys = ['axEvidenceVersion', 'scope', 'sampleType', 'fieldEpoch', 'utf16Length'];
  const changeKeys = [
    ...baseKeys,
    'previousUTF16Length',
    'insertedEstimate',
    'deletedEstimate',
    'intervalMilliseconds',
    'keyboardEventCount',
    'keyboardCoverage',
  ];
  for (const observation of observations) {
    if (observation.kind === 'telemetry_started' || observation.kind === 'telemetry_stopped') {
      reset();
      continue;
    }
    if (
      observation.kind !== 'accessibility_status' &&
      observation.kind !== 'accessibility_text_observation'
    )
      continue;
    seen = true;
    const m = observation.metadata;
    if (m.axEvidenceVersion !== '1') {
      complete = false;
      reset();
      continue;
    }
    result.trackingSupported = true;
    if (observation.kind === 'accessibility_status') {
      if (
        !keysEqual(m, ['axEvidenceVersion', 'status', 'reason']) ||
        !['observing', 'unavailable', 'suspended', 'disabled'].includes(m.status) ||
        typeof m.reason !== 'string' ||
        m.reason.length > 64 ||
        !/^[a-z0-9_]+$/.test(m.reason)
      ) {
        invalidate();
        continue;
      }
      if (m.status === 'observing') observing = true;
      else {
        complete = false;
        reset();
        if (m.status === 'unavailable' || m.status === 'suspended') add('unavailableCount');
      }
      continue;
    }
    const current = count(m.utf16Length, 100_000);
    if (
      !observing ||
      m.scope !== 'focused_text_control' ||
      typeof m.fieldEpoch !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.fieldEpoch) ||
      current === undefined
    ) {
      invalidate();
      continue;
    }
    const normalizedEpoch = m.fieldEpoch.toLowerCase();
    if (m.sampleType === 'baseline') {
      if (!keysEqual(m, baseKeys)) {
        invalidate();
        continue;
      }
      epoch = normalizedEpoch;
      length = current;
      add('baselineCount');
      continue;
    }
    const previous = count(m.previousUTF16Length, 100_000);
    const inserted = count(m.insertedEstimate, 100_000),
      deleted = count(m.deletedEstimate, 100_000);
    const interval = count(m.intervalMilliseconds, 5_000),
      keyboard = count(m.keyboardEventCount, Number.MAX_SAFE_INTEGER);
    if (
      m.sampleType !== 'change' ||
      !keysEqual(m, changeKeys) ||
      epoch !== normalizedEpoch ||
      length === undefined ||
      previous === undefined ||
      previous !== length ||
      inserted === undefined ||
      deleted === undefined ||
      deleted > previous ||
      inserted > current ||
      previous - deleted + inserted !== current ||
      (inserted === 0 && deleted === 0) ||
      interval === undefined ||
      interval === 0 ||
      keyboard === undefined ||
      !['available', 'unavailable'].includes(m.keyboardCoverage)
    ) {
      invalidate();
      continue;
    }
    length = current;
    add('changeCount');
    if (inserted >= 80) {
      add('largeChangeCount');
      if (
        current - previous >= 80 &&
        m.keyboardCoverage === 'available' &&
        keyboard <= 5 &&
        interval <= 2_500
      )
        add('lowKeyboardGrowthCount');
    }
    if (m.keyboardCoverage === 'unavailable') complete = false;
  }
  if (!seen) return undefined;
  result.trackingComplete = result.trackingSupported && complete;
  return result;
}
