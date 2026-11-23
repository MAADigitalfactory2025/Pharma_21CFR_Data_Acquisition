/**
 * ingest.js — Machine-side ingestion endpoints (API key protected).
 *
 * These endpoints are called by the simulator or the real PLC/middleware.
 * They are NOT called by the browser client.
 *
 * API key is passed in the header: X-API-Key: <key>
 *
 * Endpoints:
 *   POST /api/ingest/reading     — one or more sensor readings
 *   POST /api/ingest/state       — machine state change
 *   POST /api/ingest/batch-start — batch start message from load cell
 *
 * INGESTION PIPELINE:
 *   1. Validate API key
 *   2. Find machine by tag
 *   3. VALIDITY CHECK on each parameter
 *      - Invalid -> store ValidationError, audit log, push to Socket.IO
 *   4. Store valid reading with hash chain
 *   5. Audit log the reading
 *   6. Push to live dashboard via Socket.IO
 *   7. LIMIT CHECK on each valid parameter
 *      - Violation -> run consecutive-reading noise filter
 *      - If N consecutive -> create Alarm, audit log, push to Socket.IO
 *   8. For in-limit values -> close any open alarm for that parameter
 */
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const Machine = require('../models/Machine');
const Reading = require('../models/Reading');
const ValidationError = require('../models/ValidationError');

const { validateReading } = require('../services/validationService');
const { processViolation, processInLimit, resetMachineCounters } = require('../services/alarmService');
const { startBatch, endBatch, getActiveBatch } = require('../services/batchService');
const { logSystem } = require('../services/auditService');
const { computeHash, getLastHash } = require('../services/hashService');
const dataSource = require('../services/dataSource');
const excelLogger = require('../services/excelLogger');
const { forMachine } = require('../services/machine_limits');
const ParameterLimit = require('../models/ParameterLimit');

// API key guard
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// Validate batch load weight against capacity
// Returns true if load is within acceptable range for the model
function validateLoadKg(loadKg, machine) {
  const ranges = {
    'FBD-5': { min: 1.5, max: 5 },
    'FBD-10': { min: 3, max: 10 },
    'FBD-450': { min: 100, max: 450 },
  };
  const range = ranges[machine.model];
  if (!range) return { valid: true };
  return {
    valid: loadKg >= range.min && loadKg <= range.max,
    min: range.min,
    max: range.max,
  };
}

/**
 * POST /api/ingest/reading
 * Body: { machineTag, ts, values: { inletTemp, outletTemp, productTemp, airflow, diffPressure, inletHumidity, blowerSpeed } }
 * Supports backfill: { readings: [...] } array for offline buffer replay
 */
router.post('/reading', requireApiKey, async (req, res) => {
  try {
    const io = req.app.get('io');

    // Support single reading or backfill array
    const readings = Array.isArray(req.body.readings)
      ? req.body.readings
      : [req.body];

    const results = [];

    for (const rawReading of readings) {
      const { machineTag, ts, values } = rawReading;

      if (!machineTag || !values) {
        results.push({ error: 'Missing machineTag or values', input: rawReading });
        continue;
      }

      // Find machine
      const machine = await Machine.findOne({ tag: machineTag.toUpperCase() });
      if (!machine) {
        results.push({ error: `Machine not found: ${machineTag}` });
        continue;
      }

      const readingTs = ts ? new Date(ts) : new Date();

      // Find current batch
      const activeBatch = await getActiveBatch(machine._id);
      const batchNo = activeBatch ? activeBatch.batchNo : null;

      // === STAGE 1 + 2: Validate reading ===
      const { validationErrors, validValues, limitViolations } = await validateReading(
        machine._id.toString(),
        machine.model,
        values,
        activeBatch ? activeBatch.product : null
      );

      // Store validation errors
      for (const ve of validationErrors) {
        const prevHash = await getLastHash(ValidationError);
        const payload = {
          ts: readingTs,
          machineId: machine._id,
          machineTag: machine.tag,
          batchNo,
          parameter: ve.parameter,
          rejectedValue: ve.rejectedValue,
          reason: ve.reason,
        };
        const hash = computeHash(payload, prevHash);
        const veDoc = new ValidationError({ ...payload, prevHash, hash });
        await veDoc.save();

        // Audit log
        await logSystem('VALIDATION_ERROR', 'ValidationError', veDoc._id.toString(), {
          newValue: { parameter: ve.parameter, reason: ve.reason, value: ve.rejectedValue },
        });

        // Push to Socket.IO
        io.emit('validationError', {
          machineId: machine._id,
          machineTag: machine.tag,
          batchNo,
          parameter: ve.parameter,
          rejectedValue: ve.rejectedValue,
          reason: ve.reason,
          ts: readingTs,
        });
      }

      // If no valid values remain, skip reading storage
      if (Object.keys(validValues).length === 0 && validationErrors.length > 0) {
        results.push({ status: 'all_invalid', validationErrors });
        continue;
      }

      // Store + Excel-log only once per LOG_INTERVAL_MS per machine (2.5 min default)
      let reading = null;
      if (excelLogger.isDue(machine.tag, readingTs)) {
        // Snapshot dynamic bands from PREVIOUS persisted readings only.
        // History is isolated by machine, product/batch, and parameter.
        const engine = forMachine(machine);
        const limitSnapshots = {};
        if (engine) {
          const historyQuery = { machineId: machine._id, ts: { $lt: readingTs } };
          if (batchNo) historyQuery.batchNo = batchNo;
          else historyQuery.batchNo = null;
          const previous = await Reading.find(historyQuery).sort({ ts: -1 }).limit(300).lean();
          const approved = activeBatch?.product || null;
          for (const [parameter, currentValue] of Object.entries(validValues)) {
            if (!Object.hasOwn(engine.parameters, parameter)) continue;
            const configured = approved ? await ParameterLimit.findOne({
              product: approved, machineModel: machine.model, parameter, isActive: true,
            }).lean() : null;
            const history = previous.map(r => r.values?.[parameter]).filter(Number.isFinite);
            limitSnapshots[parameter] = engine.calculate(parameter, history, currentValue,
              configured ? { lower: configured.limitMin, upper: configured.limitMax,
                version: configured.version } : null);
          }
        }
        const prevHash = await getLastHash(Reading);
        const readingPayload = {
          ts: readingTs,
          machineId: machine._id,
          machineTag: machine.tag,
          batchNo,
          values: validValues,
          limitSnapshots,
        };
        const hash = computeHash(readingPayload, prevHash);
        reading = new Reading({ ...readingPayload, prevHash, hash });
        await reading.save();
        await excelLogger.appendRow(readingPayload);
      }

      // Push live reading to Socket.IO
      io.emit('reading', {
        machineId: machine._id,
        machineTag: machine.tag,
        batchNo,
        ts: readingTs,
        values: validValues,
      });

      // === LIMIT CHECK ===
      const openAlarmsThisCycle = new Set();

      for (const violation of limitViolations) {
        const { alarmRaised, alarm, alarmId } = await processViolation({
          machineId: machine._id.toString(),
          machineTag: machine.tag,
          batchNo,
          parameter: violation.parameter,
          displayName: violation.displayName,
          unit: violation.unit,
          value: violation.value,
          limitMin: violation.limitMin,
          limitMax: violation.limitMax,
          severity: violation.severity,
          ts: readingTs,
        });

        openAlarmsThisCycle.add(violation.parameter);

        if (alarmRaised) {
          // Audit log the new alarm
          await logSystem('ALARM_RAISED', 'Alarm', alarm._id.toString(), {
            newValue: {
              parameter: violation.parameter,
              value: violation.value,
              limitMin: violation.limitMin,
              limitMax: violation.limitMax,
              severity: violation.severity,
            },
          });

          // Push alarm to Socket.IO
          io.emit('alarm', {
            type: 'RAISED',
            machineId: machine._id,
            machineTag: machine.tag,
            batchNo,
            alarm,
          });

          // Update machine state to ALARM in DB
          await Machine.findByIdAndUpdate(machine._id, { lastKnownState: 'ALARM' });
          io.emit('machineState', { machineTag: machine.tag, state: 'ALARM', ts: readingTs });
        }
      }

      // Close alarms for parameters now in-limit
      const allParams = Object.keys(validValues);
      for (const param of allParams) {
        if (!openAlarmsThisCycle.has(param)) {
          const { alarmClosed, alarm } = await processInLimit(
            machine._id.toString(), param, readingTs
          );
          if (alarmClosed) {
            await logSystem('ALARM_CLOSED', 'Alarm', alarm._id.toString(), {
              newValue: { parameter: param, endedAt: readingTs },
            });
            io.emit('alarm', {
              type: 'CLOSED',
              machineId: machine._id,
              machineTag: machine.tag,
              batchNo,
              alarm,
            });
          }
        }
      }

      results.push({ status: 'ok', readingId: reading ? reading._id : null, logged: !!reading, batchNo, validationErrors });
    }

    res.json({ results });
  } catch (err) {
    console.error('[Ingest/reading]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ingest/state
 * Body: { machineTag, ts, state: 'IDLE'|'RUNNING'|'DRYING_COMPLETE'|'ALARM' }
 */
router.post('/state', requireApiKey, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { machineTag, ts, state } = req.body;

    if (!machineTag || !state) {
      return res.status(400).json({ error: 'Missing machineTag or state' });
    }

    const machine = await Machine.findOne({ tag: machineTag.toUpperCase() });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const stateTs = ts ? new Date(ts) : new Date();
    const prevState = machine.lastKnownState;

    // Update machine's last known state
    await Machine.findByIdAndUpdate(machine._id, { lastKnownState: state });

    // Emit to all clients
    io.emit('machineState', { machineTag: machine.tag, state, ts: stateTs });

    // State machine transitions
    if (prevState !== 'RUNNING' && state === 'RUNNING') {
      // Handled by /batch-start, but log the state change
      await logSystem('BATCH_STATE_CHANGE', 'Machine', machine._id.toString(), {
        oldValue: prevState, newValue: state,
      });
    }

    // Physical machine state is informational; batch closure is a separate user action.

    res.json({ status: 'ok', state, ts: stateTs });
  } catch (err) {
    console.error('[Ingest/state]', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/ingest/batch-start
 * Body: { machineTag, ts, product, loadKg }
 * Called when machine transitions to RUNNING and load cell sends weight.
 */
router.post('/batch-start', requireApiKey, async (req, res) => {
  try {
    const io = req.app.get('io');
    const { machineTag, ts, product, loadKg } = req.body;

    if (!machineTag || !product || loadKg === undefined) {
      return res.status(400).json({ error: 'Missing machineTag, product, or loadKg' });
    }

    const machine = await Machine.findOne({ tag: machineTag.toUpperCase() });
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const batchTs = ts ? new Date(ts) : new Date();

    // Validate load weight
    const loadValidation = validateLoadKg(Number(loadKg), machine);
    if (!loadValidation.valid) {
      // Store a CRITICAL alarm for overload
      const Alarm = require('../models/Alarm');
      const alarm = new Alarm({
        machineId: machine._id,
        machineTag: machine.tag,
        batchNo: null,
        parameter: 'loadKg',
        displayName: 'Batch Loading Weight',
        unit: 'kg',
        value: Number(loadKg),
        limitMin: loadValidation.min,
        limitMax: loadValidation.max,
        severity: 'CRITICAL',
        startedAt: batchTs,
        status: 'OPEN',
        consecutiveCount: 1,
      });
      await alarm.save();

      await logSystem('ALARM_RAISED', 'Alarm', alarm._id.toString(), {
        newValue: {
          parameter: 'loadKg',
          value: loadKg,
          limitMin: loadValidation.min,
          limitMax: loadValidation.max,
          reason: 'Load weight exceeds machine capacity',
        },
      });

      io.emit('alarm', {
        type: 'RAISED',
        machineId: machine._id,
        machineTag: machine.tag,
        alarm,
      });

      return res.status(422).json({
        error: 'Load weight out of range',
        loadKg,
        allowedMin: loadValidation.min,
        allowedMax: loadValidation.max,
        alarmId: alarm._id,
      });
    }

    // Machine signals do not register production batches. The operator creates them in the UI.
    const existing = await getActiveBatch(machine._id);
    res.json({ status: 'ok', batchNo: existing?.batchNo || null,
      message: 'Machine signal received; batch registration is performed in Machine Monitoring.' });
  } catch (err) {
    console.error('[Ingest/batch-start]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
