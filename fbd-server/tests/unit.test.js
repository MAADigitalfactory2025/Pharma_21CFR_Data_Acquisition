/**
 * unit.test.js — Unit tests for core FBD system logic.
 *
 * Tests:
 *   1. Validity check (null, non-numeric, out-of-sensor-range, spike)
 *   2. Limit check with N-consecutive filter (noise filter)
 *   3. Batch number generation (format, uniqueness, daily sequence)
 *   4. Hash chain (intact chain, tampered chain detection)
 *
 * Run with: npm test (in /server directory)
 */

const crypto = require('crypto');

// ===== 1. Validity Check Tests =====

// Extract the pure validity check logic (no DB calls)
const prevValuesTest = {};
function checkValidityPure(machineId, parameter, value, limitDef) {
  const key = `${machineId}_${parameter}`;
  if (value === null || value === undefined || value === '') {
    return { valid: false, reason: 'NULL_VALUE' };
  }
  const numValue = Number(value);
  if (isNaN(numValue)) {
    return { valid: false, reason: 'NOT_NUMERIC' };
  }
  if (limitDef && (numValue < limitDef.validMin || numValue > limitDef.validMax)) {
    return { valid: false, reason: 'OUT_OF_SENSOR_RANGE' };
  }
  const prev = prevValuesTest[key];
  if (prev && prev.prevValue !== null) {
    const prevNum = Number(prev.prevValue);
    if (Math.abs(prevNum) > 1 && Math.abs((numValue - prevNum) / prevNum) > 0.8) {
      prevValuesTest[key] = { prevValue: numValue, stuckCount: 0 };
      return { valid: false, reason: 'SPIKE' };
    }
    if (numValue === prevNum) {
      prev.stuckCount = (prev.stuckCount || 0) + 1;
      if (prev.stuckCount >= 10) {
        return { valid: false, reason: 'STUCK' };
      }
    } else {
      prev.stuckCount = 0;
    }
  }
  prevValuesTest[key] = { prevValue: numValue, stuckCount: (prev ? prev.stuckCount : 0) };
  return { valid: true, reason: null };
}

describe('Validity Check', () => {
  const limitDef = { validMin: 0, validMax: 150 };

  beforeEach(() => {
    // Clear previous values
    Object.keys(prevValuesTest).forEach(k => delete prevValuesTest[k]);
  });

  test('null value returns NULL_VALUE', () => {
    expect(checkValidityPure('m1', 'inletTemp', null, limitDef)).toEqual({ valid: false, reason: 'NULL_VALUE' });
  });

  test('undefined value returns NULL_VALUE', () => {
    expect(checkValidityPure('m1', 'inletTemp', undefined, limitDef)).toEqual({ valid: false, reason: 'NULL_VALUE' });
  });

  test('empty string returns NULL_VALUE', () => {
    expect(checkValidityPure('m1', 'inletTemp', '', limitDef)).toEqual({ valid: false, reason: 'NULL_VALUE' });
  });

  test('non-numeric string returns NOT_NUMERIC', () => {
    expect(checkValidityPure('m1', 'inletTemp', 'abc', limitDef)).toEqual({ valid: false, reason: 'NOT_NUMERIC' });
  });

  test('value below sensor range returns OUT_OF_SENSOR_RANGE', () => {
    expect(checkValidityPure('m1', 'inletTemp', -5, limitDef)).toEqual({ valid: false, reason: 'OUT_OF_SENSOR_RANGE' });
  });

  test('value above sensor range returns OUT_OF_SENSOR_RANGE', () => {
    expect(checkValidityPure('m1', 'inletTemp', 160, limitDef)).toEqual({ valid: false, reason: 'OUT_OF_SENSOR_RANGE' });
  });

  test('-999 (common PLC fault code) returns OUT_OF_SENSOR_RANGE', () => {
    expect(checkValidityPure('m1', 'inletTemp', -999, limitDef)).toEqual({ valid: false, reason: 'OUT_OF_SENSOR_RANGE' });
  });

  test('valid value within sensor range passes', () => {
    expect(checkValidityPure('m1', 'inletTemp', 60, limitDef)).toEqual({ valid: true, reason: null });
  });

  test('spike (>80% change) returns SPIKE', () => {
    checkValidityPure('m2', 'inletTemp', 60, limitDef); // set prev value
    const result = checkValidityPure('m2', 'inletTemp', 110, limitDef); // 83% jump
    expect(result).toEqual({ valid: false, reason: 'SPIKE' });
  });

  test('gradual change does not trigger SPIKE', () => {
    checkValidityPure('m3', 'inletTemp', 60, limitDef);
    const result = checkValidityPure('m3', 'inletTemp', 62, limitDef); // ~3% change
    expect(result).toEqual({ valid: true, reason: null });
  });

  test('stuck value for 10+ readings returns STUCK', () => {
    for (let i = 0; i < 11; i++) {
      checkValidityPure('m4', 'inletTemp', 60, limitDef);
    }
    const result = checkValidityPure('m4', 'inletTemp', 60, limitDef);
    expect(result.reason).toBe('STUCK');
  });
});

// ===== 2. Limit Check with Consecutive Filter =====

const THRESHOLD = 3;

class ConsecutiveAlarmFilter {
  constructor(threshold = THRESHOLD) {
    this.threshold = threshold;
    this.state = {}; // key -> { count, alarmOpen }
  }

  process(machineId, parameter, value, limitMin, limitMax) {
    const key = `${machineId}_${parameter}`;
    const isViolation = value < limitMin || value > limitMax;

    if (isViolation) {
      this.state[key] = this.state[key] || { count: 0, alarmOpen: false };
      this.state[key].count++;
      if (this.state[key].count >= this.threshold && !this.state[key].alarmOpen) {
        this.state[key].alarmOpen = true;
        return { alarmRaised: true, count: this.state[key].count };
      }
      return { alarmRaised: false, count: this.state[key].count };
    } else {
      const wasOpen = this.state[key] && this.state[key].alarmOpen;
      this.state[key] = { count: 0, alarmOpen: false };
      return { alarmClosed: wasOpen, alarmRaised: false, count: 0 };
    }
  }
}

describe('Limit Check with Consecutive Filter', () => {
  let filter;

  beforeEach(() => {
    filter = new ConsecutiveAlarmFilter(3);
  });

  test('single out-of-limit reading does not raise alarm', () => {
    const result = filter.process('m1', 'inletTemp', 75, 50, 70);
    expect(result.alarmRaised).toBe(false);
    expect(result.count).toBe(1);
  });

  test('two consecutive out-of-limit readings do not raise alarm', () => {
    filter.process('m1', 'inletTemp', 75, 50, 70);
    const result = filter.process('m1', 'inletTemp', 76, 50, 70);
    expect(result.alarmRaised).toBe(false);
    expect(result.count).toBe(2);
  });

  test('three consecutive out-of-limit readings raise an alarm', () => {
    filter.process('m1', 'inletTemp', 75, 50, 70);
    filter.process('m1', 'inletTemp', 76, 50, 70);
    const result = filter.process('m1', 'inletTemp', 77, 50, 70);
    expect(result.alarmRaised).toBe(true);
    expect(result.count).toBe(3);
  });

  test('in-limit reading after alarm resets counter', () => {
    // Raise alarm
    filter.process('m1', 'inletTemp', 75, 50, 70);
    filter.process('m1', 'inletTemp', 76, 50, 70);
    filter.process('m1', 'inletTemp', 77, 50, 70); // alarm raised

    // Return to limit
    const result = filter.process('m1', 'inletTemp', 60, 50, 70);
    expect(result.alarmClosed).toBe(true);
    expect(result.count).toBe(0);
  });

  test('single in-limit interruption resets counter (noise filter)', () => {
    filter.process('m1', 'inletTemp', 75, 50, 70); // count: 1
    filter.process('m1', 'inletTemp', 60, 50, 70); // back in limit, reset
    filter.process('m1', 'inletTemp', 76, 50, 70); // count: 1 (not 3, no alarm)
    filter.process('m1', 'inletTemp', 77, 50, 70); // count: 2
    const result = filter.process('m1', 'inletTemp', 78, 50, 70); // count: 3 -> alarm
    expect(result.alarmRaised).toBe(true);
  });

  test('in-limit value is not a violation', () => {
    const result = filter.process('m1', 'inletTemp', 60, 50, 70);
    expect(result.alarmRaised).toBe(false);
  });

  test('boundary values: exactly at limit are not violations', () => {
    const atMin = filter.process('m1', 'inletTemp', 50, 50, 70);
    const atMax = filter.process('m1', 'inletTemp', 70, 50, 70);
    expect(atMin.alarmRaised).toBe(false);
    expect(atMax.alarmRaised).toBe(false);
  });
});

// ===== 3. Batch Number Generation =====

function generateBatchNoSync(model, capacityKg, date, sequence) {
  const yymmdd = date.toISOString().slice(2, 10).replace(/-/g, '');
  const seq = String(sequence).padStart(3, '0');
  return `FBD${capacityKg}-${yymmdd}-${seq}`;
}

describe('Batch Number Generation', () => {
  const testDate = new Date('2026-11-04T10:00:00Z');

  test('FBD-5 batch number format is correct', () => {
    const batchNo = generateBatchNoSync('FBD-5', 5, testDate, 1);
    expect(batchNo).toBe('FBD5-261104-001');
  });

  test('FBD-10 batch number format is correct', () => {
    const batchNo = generateBatchNoSync('FBD-10', 10, testDate, 1);
    expect(batchNo).toBe('FBD10-261104-001');
  });

  test('sequence is zero-padded to 3 digits', () => {
    expect(generateBatchNoSync('FBD-5', 5, testDate, 1)).toMatch(/-001$/);
    expect(generateBatchNoSync('FBD-5', 5, testDate, 9)).toMatch(/-009$/);
    expect(generateBatchNoSync('FBD-5', 5, testDate, 10)).toMatch(/-010$/);
    expect(generateBatchNoSync('FBD-5', 5, testDate, 100)).toMatch(/-100$/);
  });

  test('different dates produce different batch numbers', () => {
    const date1 = new Date('2026-11-04T10:00:00Z');
    const date2 = new Date('2026-11-05T10:00:00Z');
    expect(generateBatchNoSync('FBD-5', 5, date1, 1)).not.toBe(generateBatchNoSync('FBD-5', 5, date2, 1));
  });

  test('batch number contains machine capacity', () => {
    const fbd5 = generateBatchNoSync('FBD-5', 5, testDate, 1);
    const fbd10 = generateBatchNoSync('FBD-10', 10, testDate, 1);
    expect(fbd5).toContain('FBD5');
    expect(fbd10).toContain('FBD10');
  });

  test('batch number matches expected regex pattern', () => {
    const batchNo = generateBatchNoSync('FBD-5', 5, testDate, 1);
    expect(batchNo).toMatch(/^FBD\d+-\d{6}-\d{3}$/);
  });
});

// ===== 4. Hash Chain Tests =====

function computeHash(payload, prevHash) {
  const data = JSON.stringify(payload) + prevHash;
  return crypto.createHash('sha256').update(data).digest('hex');
}

function buildChain(records) {
  let prevHash = 'GENESIS';
  return records.map(record => {
    const hash = computeHash(record, prevHash);
    const doc = { ...record, prevHash, hash };
    prevHash = hash;
    return doc;
  });
}

function verifyChain(docs) {
  let expectedPrevHash = 'GENESIS';
  for (let i = 0; i < docs.length; i++) {
    const { prevHash, hash, ...payload } = docs[i];
    const expectedHash = computeHash(payload, expectedPrevHash);
    if (expectedHash !== hash) {
      return { intact: false, brokenAt: i, doc: docs[i] };
    }
    expectedPrevHash = hash;
  }
  return { intact: true, brokenAt: null };
}

describe('Hash Chain', () => {
  const records = [
    { ts: '2026-11-04T10:00:00Z', machineId: 'm1', value: 60 },
    { ts: '2026-11-04T10:00:01Z', machineId: 'm1', value: 61 },
    { ts: '2026-11-04T10:00:02Z', machineId: 'm1', value: 62 },
    { ts: '2026-11-04T10:00:03Z', machineId: 'm1', value: 63 },
    { ts: '2026-11-04T10:00:04Z', machineId: 'm1', value: 64 },
  ];

  test('intact chain verifies successfully', () => {
    const chain = buildChain(records);
    expect(verifyChain(chain)).toEqual({ intact: true, brokenAt: null });
  });

  test('first record uses GENESIS as prevHash', () => {
    const chain = buildChain(records);
    expect(chain[0].prevHash).toBe('GENESIS');
  });

  test('each record prevHash equals the previous record hash', () => {
    const chain = buildChain(records);
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i].prevHash).toBe(chain[i - 1].hash);
    }
  });

  test('tampering a record value breaks the chain at that record', () => {
    const chain = buildChain(records);
    // Tamper record at index 2
    chain[2] = { ...chain[2], value: 999 }; // Change value but keep old hash
    const result = verifyChain(chain);
    expect(result.intact).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  test('tampering a record and updating hash breaks the chain at the NEXT record', () => {
    const chain = buildChain(records);
    // Tamper record at index 1 AND recompute its hash (attacker tries to cover tracks)
    const tampered = { ...chain[1], value: 999 };
    const { prevHash } = chain[1];
    tampered.hash = computeHash({ ts: tampered.ts, machineId: tampered.machineId, value: 999 }, prevHash);
    chain[1] = tampered;
    // Chain breaks at record 2 because prevHash won't match
    const result = verifyChain(chain);
    expect(result.intact).toBe(false);
    expect(result.brokenAt).toBe(2);
  });

  test('identical payloads with different prevHash produce different hashes', () => {
    const payload = { ts: '2026-11-04T10:00:00Z', value: 60 };
    const hash1 = computeHash(payload, 'GENESIS');
    const hash2 = computeHash(payload, 'some_other_hash');
    expect(hash1).not.toBe(hash2);
  });

  test('hash is deterministic for the same input', () => {
    const payload = { ts: '2026-11-04T10:00:00Z', value: 60 };
    expect(computeHash(payload, 'GENESIS')).toBe(computeHash(payload, 'GENESIS'));
  });

  test('empty chain verifies as intact', () => {
    expect(verifyChain([])).toEqual({ intact: true, brokenAt: null });
  });
});
