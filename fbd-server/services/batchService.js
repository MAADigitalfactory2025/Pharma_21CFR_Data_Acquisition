/**
 * batchService.js — Batch lifecycle management and auto-number generation.
 *
 * Batch number format: FBD{capacity}-YYMMDD-NNN
 *   e.g. FBD5-261104-001  (FBD-5, Nov 4 2026, 1st batch of day)
 *        FBD10-261104-002 (FBD-10, Nov 4 2026, 2nd batch of day)
 *
 * The sequence (NNN) is per-machine-model per-day.
 * It is derived from the count of batches that started on that calendar day
 * for that machine, so it is determined from the database — no separate counter.
 *
 * Batch number is immutable after creation (Mongoose immutable field + no update route).
 */
const Batch = require('../models/Batch');
const Reading = require('../models/Reading');
const Alarm = require('../models/Alarm');
const ValidationError = require('../models/ValidationError');

const PARAMETERS = ['inletTemp', 'outletTemp', 'productTemp', 'airflow', 'diffPressure', 'inletHumidity', 'blowerSpeed'];

/**
 * Min, max, average, and sample count for each process parameter.
 * A missing parameter on a reading is skipped, not treated as zero.
 */
function parameterStatsFromReadings(readings) {
  const parameterStats = {};
  for (const param of PARAMETERS) {
    const vals = readings
      .map((r) => r.values && r.values[param])
      .filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) {
      parameterStats[param] = { min: null, max: null, avg: null, count: 0 };
      continue;
    }
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    parameterStats[param] = { min, max, avg: parseFloat(avg.toFixed(2)), count: vals.length };
  }
  return parameterStats;
}

/**
 * Totals for a batch that is still drying. Not written to the database.
 * The stored summary is created only when the batch ends.
 */
async function liveSummary(batch, { alarmCount, validationErrorCount, now = new Date() } = {}) {
  const readings = await Reading.find({ batchNo: batch.batchNo }).select('values').lean();
  const started = batch.startedAt ? new Date(batch.startedAt) : null;
  const durationMinutes = started
    ? parseFloat(((now - started) / 60000).toFixed(2))
    : 0;
  return {
    durationMinutes,
    alarmCount: alarmCount || 0,
    validationErrorCount: validationErrorCount || 0,
    readingCount: readings.length,
    parameterStats: parameterStatsFromReadings(readings),
    processResult: null,
    live: true,
  };
}

/**
 * Generate the next batch number for a machine.
 * @param {Object} machine - { model, capacityKg }
 * @param {Date} [now] - timestamp for the batch start (defaults to now)
 * @returns {Promise<string>} e.g. 'FBD5-261104-001'
 */
async function generateBatchNo(machine, now = new Date()) {
  const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const prefix = `FBD${machine.capacityKg}-${yymmdd}-`;

  // Count how many batches exist for this model today
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  const count = await Batch.countDocuments({
    machineModel: machine.model,
    startedAt: { $gte: startOfDay, $lt: endOfDay },
  });

  const seq = String(count + 1).padStart(3, '0');
  return `${prefix}${seq}`;
}

/**
 * Auto-start a batch when machine transitions IDLE -> RUNNING.
 * Product and loadKg come from the machine/simulator batch-start message.
 *
 * @param {Object} options
 * @param {Object} options.machine - Mongoose machine document
 * @param {string} options.product
 * @param {number} options.loadKg
 * @param {Date} options.ts
 * @returns {Promise<Object>} the created Batch document
 */
async function startBatch({ machine, product, loadKg, ts }) {
  const batchNo = await generateBatchNo(machine, ts);

  const batch = new Batch({
    batchNo,
    machineId: machine._id,
    machineTag: machine.tag,
    machineModel: machine.model,
    product,
    loadKg,
    capacityKg: machine.capacityKg,
    startedAt: ts,
    state: 'RUNNING',
    status: 'RUNNING',
  });

  await batch.save();
  return batch;
}

/**
 * Auto-end a batch when machine transitions RUNNING -> DRYING_COMPLETE.
 * Computes summary: duration, min/max/avg per parameter, alarm count, etc.
 *
 * @param {Object} options
 * @param {string} options.batchNo
 * @param {Date} options.ts
 * @returns {Promise<Object>} the updated Batch document
 */
async function endBatch({ batchNo, ts }) {
  const batch = await Batch.findOne({ batchNo });
  if (!batch) throw new Error(`Batch not found: ${batchNo}`);

  // Compute reading statistics
  const readings = await Reading.find({ batchNo }).lean();
  const alarmCount = await Alarm.countDocuments({ batchNo });
  const validationErrorCount = await ValidationError.countDocuments({ batchNo });

  const parameterStats = parameterStatsFromReadings(readings);

  const durationMinutes = batch.startedAt
    ? parseFloat(((ts - batch.startedAt) / 60000).toFixed(2))
    : 0;

  const processResult = alarmCount > 0 ? 'DEVIATION' : 'PROCESS OK';

  batch.state = 'DRYING_COMPLETE';
  batch.status = 'COMPLETE';
  batch.endedAt = ts;
  batch.summary = {
    durationMinutes,
    alarmCount,
    validationErrorCount,
    readingCount: readings.length,
    parameterStats,
    processResult,
  };

  await batch.save();
  return batch;
}

/**
 * Find the currently running batch for a machine.
 * @param {string} machineId
 * @returns {Promise<Object|null>}
 */
async function getActiveBatch(machineId) {
  return Batch.findOne({ machineId, state: 'RUNNING' }).lean();
}

module.exports = { generateBatchNo, startBatch, endBatch, getActiveBatch, liveSummary, parameterStatsFromReadings };
