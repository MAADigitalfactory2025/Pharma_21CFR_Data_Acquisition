/**
 * alarmService.js — Consecutive-reading alarm filter and alarm lifecycle.
 *
 * Noise filter: an alarm is raised ONLY if a parameter stays outside the
 * process limit for N consecutive readings (ALARM_CONSECUTIVE_THRESHOLD).
 * This prevents false alarms from momentary spikes.
 *
 * In-memory state: consecutive counters per (machineId, parameter).
 * This state is lost on server restart; on restart, the counter resets to 0.
 * This is intentional — a restart clears the noise filter state.
 *
 * Alarm auto-close: when the value returns to within limits, the alarm
 * document is updated with endedAt, peakValue, and status=CLOSED.
 */
const Alarm = require('../models/Alarm');

// Alarm state is recovered from MongoDB after a server restart.
// A missing/invalid sensor value never closes an alarm.

// In-memory consecutive-out-of-limit counters
// Key: `${machineId}_${parameter}` -> { count, alarmId, peakValue }
const consecutiveState = {};

const THRESHOLD = parseInt(process.env.ALARM_CONSECUTIVE_THRESHOLD) || 3;

/**
 * Process a limit violation for a single parameter.
 * Creates or updates an alarm based on consecutive count.
 *
 * @param {Object} options
 * @param {string} options.machineId
 * @param {string} options.machineTag
 * @param {string} options.batchNo
 * @param {string} options.parameter
 * @param {string} options.displayName
 * @param {string} options.unit
 * @param {number} options.value
 * @param {number} options.limitMin
 * @param {number} options.limitMax
 * @param {string} options.severity
 * @param {Date} options.ts
 * @returns {Promise<{ alarmRaised: boolean, alarm: Object|null }>}
 */
async function processViolation({ machineId, machineTag, batchNo, parameter, displayName, unit, value, limitMin, limitMax, severity, ts }) {
  const key = `${machineId}_${parameter}`;
  let state = consecutiveState[key];
  if (!state || !state.alarmId) {
    const existing = await Alarm.findOne({ machineId, parameter, status: 'OPEN' }).sort({ startedAt: -1 });
    if (existing) {
      state = { count: existing.consecutiveCount || THRESHOLD, alarmId: String(existing._id), peakValue: existing.peakValue ?? existing.value };
    } else if (!state) {
      state = { count: 0, alarmId: null, peakValue: value };
    }
  }

  state.count += 1;
  state.peakValue = Math.abs(value - (limitMin + limitMax) / 2) >
    Math.abs(state.peakValue - (limitMin + limitMax) / 2) ? value : state.peakValue;

  consecutiveState[key] = state;

  // Alarm not yet raised — check if threshold reached
  if (!state.alarmId) {
    if (state.count >= THRESHOLD) {
      // Create new alarm
      const alarm = new Alarm({
        machineId,
        machineTag,
        batchNo,
        parameter,
        displayName,
        unit,
        value,
        limitMin,
        limitMax,
        severity,
        startedAt: ts,
        peakValue: state.peakValue,
        consecutiveCount: state.count,
        status: 'OPEN',
      });
      await alarm.save();
      state.alarmId = alarm._id.toString();
      consecutiveState[key] = state;
      return { alarmRaised: true, alarm };
    }
    return { alarmRaised: false, alarm: null };
  }

  // Alarm already open — update peak value
  await Alarm.findByIdAndUpdate(state.alarmId, {
    peakValue: state.peakValue,
    consecutiveCount: state.count,
  });

  return { alarmRaised: false, alarm: null, alarmId: state.alarmId };
}

/**
 * Process an in-limit reading — may close an open alarm.
 *
 * @param {string} machineId
 * @param {string} parameter
 * @param {Date} ts
 * @returns {Promise<{ alarmClosed: boolean, alarm: Object|null }>}
 */
async function processInLimit(machineId, parameter, ts) {
  const key = `${machineId}_${parameter}`;
  // Query persistent state: a restart must not strand an open alarm.
  // Atomic OPEN -> CLOSED transition prevents duplicate closure events.
  const alarm = await Alarm.findOneAndUpdate(
    { machineId, parameter, status: 'OPEN' },
    { $set: { endedAt: ts, status: 'CLOSED' } },
    { new: true, sort: { startedAt: -1 } }
  );

  consecutiveState[key] = { count: 0, alarmId: null, peakValue: null };
  return { alarmClosed: !!alarm, alarm: alarm || null };
}

/**
 * Get all currently open alarm IDs for a machine.
 * @param {string} machineId
 * @returns {Promise<Array>}
 */
async function getOpenAlarms(machineId) {
  return Alarm.find({ machineId, status: 'OPEN' }).lean();
}

/**
 * Reset consecutive counters for a machine (call on batch end or machine idle).
 * @param {string} machineId
 */
function resetMachineCounters(machineId) {
  const prefix = `${machineId}_`;
  for (const key of Object.keys(consecutiveState)) {
    if (key.startsWith(prefix)) {
      delete consecutiveState[key];
    }
  }
}

module.exports = {
  processViolation,
  processInLimit,
  getOpenAlarms,
  resetMachineCounters,
};
