/**
 * validationService.js — Two-stage validation for incoming sensor readings.
 *
 * STAGE 1 — VALIDITY CHECK (is the sensor value physically plausible?)
 *   Checks: null/undefined, not numeric, out of sensor range, spike, stuck
 *   On failure: reject reading, do NOT store in readings, store in validation_errors
 *
 * STAGE 2 — LIMIT CHECK (is a valid value within process operating limits?)
 *   Checks: within limitMin..limitMax
 *   On failure: store reading normally AND create an alarm entry
 *   Alarm is raised only after N consecutive out-of-limit readings (noise filter)
 *
 * Both checks use limits stored in the ParameterLimit collection (DATA, not code).
 */
const ParameterLimit = require('../models/ParameterLimit');

// In-memory cache for limits (refreshed every 60 seconds)
let limitsCache = {};
let sensorCache = {};
let cacheLastRefreshed = 0;
const CACHE_TTL_MS = 60000;

/**
 * Load active limits from DB into memory cache.
 * Process limits: limits[machineModel][product][parameter]
 * Sensor ranges: sensorCache[machineModel][parameter] (same for every medicine)
 */
async function refreshLimitsCache() {
  const now = Date.now();
  if (now - cacheLastRefreshed < CACHE_TTL_MS) return;

  const limits = await ParameterLimit.find({
    isActive: true,
    product: { $exists: true, $nin: [null, ''] },
  }).lean();
  limitsCache = {};
  sensorCache = {};
  for (const lim of limits) {
    if (!limitsCache[lim.machineModel]) limitsCache[lim.machineModel] = {};
    if (!limitsCache[lim.machineModel][lim.product]) limitsCache[lim.machineModel][lim.product] = {};
    limitsCache[lim.machineModel][lim.product][lim.parameter] = lim;

    if (!sensorCache[lim.machineModel]) sensorCache[lim.machineModel] = {};
    sensorCache[lim.machineModel][lim.parameter] = {
      validMin: lim.validMin,
      validMax: lim.validMax,
    };
  }
  cacheLastRefreshed = now;
}

/** Force refresh of limits cache (call after limit update) */
function invalidateLimitsCache() {
  cacheLastRefreshed = 0;
}

/**
 * Active process limits for one medicine on one machine model.
 * An unknown product returns an empty map so another medicine's band is never applied.
 * @param {string} machineModel
 * @param {string|null} product
 * @returns {Promise<Object>} map of parameter -> limit object
 */
async function getLimitsForProduct(machineModel, product) {
  await refreshLimitsCache();
  if (!product) return {};
  return (limitsCache[machineModel] && limitsCache[machineModel][product]) || {};
}

/**
 * Sensor plausibility range for a machine model. Independent of the medicine.
 */
async function getSensorRanges(machineModel) {
  await refreshLimitsCache();
  return sensorCache[machineModel] || {};
}

/** @deprecated Use getLimitsForProduct. Kept so older callers still resolve a model map. */
async function getLimitsForModel(machineModel) {
  await refreshLimitsCache();
  return limitsCache[machineModel] || {};
}

// In-memory tracking of previous values per machine (for spike/stuck detection)
// Key: machineId_parameter -> { prevValue, stuckCount }
const prevValues = {};

/**
 * STAGE 1: Validity check for a single parameter value.
 *
 * @param {string} machineId
 * @param {string} parameter - parameter key e.g. 'inletTemp'
 * @param {*} value - raw value from sensor
 * @param {Object} limitDef - limit definition from cache { validMin, validMax, ... }
 * @returns {{ valid: boolean, reason: string|null }}
 */
function checkValidity(machineId, parameter, value, limitDef) {
  const key = `${machineId}_${parameter}`;

  // NULL_VALUE check
  if (value === null || value === undefined || value === '') {
    prevValues[key] = prevValues[key] || { prevValue: null, stuckCount: 0 };
    return { valid: false, reason: 'NULL_VALUE' };
  }

  // NOT_NUMERIC check
  const numValue = Number(value);
  if (isNaN(numValue)) {
    return { valid: false, reason: 'NOT_NUMERIC' };
  }

  // OUT_OF_SENSOR_RANGE check (using validMin/validMax from limit definition)
  if (limitDef) {
    if (numValue < limitDef.validMin || numValue > limitDef.validMax) {
      return { valid: false, reason: 'OUT_OF_SENSOR_RANGE' };
    }
  }

  const prev = prevValues[key];
  if (prev && prev.prevValue !== null) {
    // SPIKE check: >80% change in one step (excluding very small values)
    const prevNum = Number(prev.prevValue);
    if (Math.abs(prevNum) > 1 && Math.abs((numValue - prevNum) / prevNum) > 0.8) {
      prevValues[key] = { prevValue: numValue, stuckCount: 0 };
      return { valid: false, reason: 'SPIKE' };
    }

    // STUCK check: same value for >10 consecutive readings
    if (numValue === prevNum) {
      prev.stuckCount = (prev.stuckCount || 0) + 1;
      if (prev.stuckCount >= 10) {
        return { valid: false, reason: 'STUCK' };
      }
    } else {
      prev.stuckCount = 0;
    }
  }

  prevValues[key] = { prevValue: numValue, stuckCount: (prev ? prev.stuckCount : 0) };
  return { valid: true, reason: null };
}

/**
 * STAGE 2: Limit check for a valid numeric value.
 *
 * @param {number} value - validated numeric value
 * @param {Object} limitDef - { limitMin, limitMax, severity, displayName, unit }
 * @returns {{ withinLimit: boolean, limitMin: number, limitMax: number, severity: string }}
 */
function checkLimit(value, limitDef) {
  if (!limitDef) return { withinLimit: true };

  const withinLimit = value >= limitDef.limitMin && value <= limitDef.limitMax;
  return {
    withinLimit,
    limitMin: limitDef.limitMin,
    limitMax: limitDef.limitMax,
    severity: limitDef.severity,
  };
}

/**
 * Run both validity and limit checks for all parameters in a reading.
 *
 * @param {string} machineId
 * @param {string} machineModel - e.g. 'FBD-5'
 * @param {Object} values - { inletTemp, outletTemp, productTemp, ... }
 * @param {string|null} product - medicine on the running batch; null skips the process-limit check
 * @returns {Promise<{
 *   validationErrors: Array<{parameter, rejectedValue, reason}>,
 *   validValues: Object,
 *   limitViolations: Array<{parameter, value, limitMin, limitMax, severity}>
 * }>}
 */
async function validateReading(machineId, machineModel, values, product) {
  const limits = await getLimitsForProduct(machineModel, product);
  const sensors = await getSensorRanges(machineModel);
  const validationErrors = [];
  const validValues = {};
  const limitViolations = [];

  for (const [parameter, rawValue] of Object.entries(values)) {
    const limitDef = limits[parameter];
    const sensorDef = limitDef || sensors[parameter];

    // Stage 1: Validity check (sensor range, not the medicine band)
    const { valid, reason } = checkValidity(machineId, parameter, rawValue, sensorDef);

    if (!valid) {
      validationErrors.push({ parameter, rejectedValue: rawValue, reason });
      continue; // Do not proceed to limit check for invalid values
    }

    const numValue = Number(rawValue);
    validValues[parameter] = numValue;

    // Stage 2: Limit check (only for valid values)
    if (limitDef) {
      const limitResult = checkLimit(numValue, limitDef);
      if (!limitResult.withinLimit) {
        limitViolations.push({
          parameter,
          value: numValue,
          limitMin: limitResult.limitMin,
          limitMax: limitResult.limitMax,
          severity: limitResult.severity,
          displayName: limitDef.displayName,
          unit: limitDef.unit,
        });
      }
    }
  }

  return { validationErrors, validValues, limitViolations };
}

module.exports = {
  validateReading,
  getLimitsForModel,
  getLimitsForProduct,
  invalidateLimitsCache,
};
