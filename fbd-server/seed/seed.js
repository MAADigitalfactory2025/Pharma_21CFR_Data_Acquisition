/**
 * seed.js — Database seed script.
 * Run with: npm run seed
 *
 * Creates:
 *   - 3 machines: FBD-5-01, FBD-10-01, FBD-450-01
 *   - Parameter limits per medicine on both models (all 7 parameters)
 *   - 3 historical batches (2 complete with alarms, 1 approved)
 *   - Sample alarms and audit log entries
 *   - System start audit log
 *
 * This ensures all UI pages show real data on first run.
 * Safe to run multiple times — skips if data already exists.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');

const Machine = require('../models/Machine');
const Batch = require('../models/Batch');
const Reading = require('../models/Reading');
const Alarm = require('../models/Alarm');
const ValidationError = require('../models/ValidationError');
const AuditLog = require('../models/AuditLog');

const { computeHash, getLastHash } = require('../services/hashService');
const { catalogEntries, ensureProductLimits } = require('../services/limitCatalog');

function noise(base, amplitude) {
  return parseFloat((base + (Math.random() - 0.5) * 2 * amplitude).toFixed(2));
}

async function insertReading(machineId, machineTag, batchNo, ts, values) {
  const prevHash = await getLastHash(Reading);
  const payload = { ts, machineId, machineTag, batchNo, values };
  const hash = computeHash(payload, prevHash);
  const doc = new Reading({ ...payload, prevHash, hash });
  await doc.save();
  return doc;
}

async function insertAuditLog(action, userId, userName, role, entity, entityId, options = {}) {
  const prevHash = await getLastHash(AuditLog);
  const ts = options.ts || new Date();
  const payload = {
    ts,
    userId, userName, role, action,
    entity: entity || null,
    entityId: entityId ? String(entityId) : null,
    oldValue: options.oldValue || null,
    newValue: options.newValue || null,
    reason: options.reason || null,
  };
  const hash = computeHash(payload, prevHash);
  const log = new AuditLog({ ...payload, prevHash, hash });
  await log.save();
  return log;
}

async function seed() {
  await connectDB();
  console.log('\n[Seed] Starting database seed...\n');

  // ===== MACHINES =====
  let fbd5 = await Machine.findOne({ tag: 'FBD-5-01' });
  let fbd10 = await Machine.findOne({ tag: 'FBD-10-01' });

  if (!fbd5) {
    fbd5 = await Machine.create({
      tag: 'FBD-5-01',
      name: 'Fluid Bed Dryer 5 kg – Unit 01',
      model: 'FBD-5',
      capacityKg: 5,
      location: 'Production Block A, Room 101',
      status: 'ACTIVE',
      calibrationDue: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      lastCleanedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      lastKnownState: 'IDLE',
    });
    console.log('[Seed] Created machine: FBD-5-01');
  } else {
    console.log('[Seed] Machine FBD-5-01 already exists, skipping.');
  }

  if (!fbd10) {
    fbd10 = await Machine.create({
      tag: 'FBD-10-01',
      name: 'Fluid Bed Dryer 10 kg – Unit 01',
      model: 'FBD-10',
      capacityKg: 10,
      location: 'Production Block A, Room 102',
      status: 'ACTIVE',
      calibrationDue: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
      lastCleanedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
      lastKnownState: 'IDLE',
    });
    console.log('[Seed] Created machine: FBD-10-01');
  } else {
    console.log('[Seed] Machine FBD-10-01 already exists, skipping.');
  }

  if (!(await Machine.exists({ tag: 'FBD-450-01' }))) {
    await Machine.create({
      tag: 'FBD-450-01',
      name: 'Fluid Bed Dryer 450 kg – Unit 01',
      model: 'FBD-450',
      capacityKg: 450,
      location: 'Production Block B, Room 201',
      status: 'ACTIVE',
      calibrationDue: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
      lastCleanedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      lastKnownState: 'IDLE',
    });
    console.log('[Seed] Created machine: FBD-450-01');
  }

  // ===== PARAMETER LIMITS (one set per medicine and machine model) =====
  const limitResult = await ensureProductLimits();
  console.log(`[Seed] Medicine limits: created ${limitResult.created}, retired legacy ${limitResult.retired} (catalog ${catalogEntries().length}).`);

  // ===== HISTORICAL BATCHES =====
  const existingBatches = await Batch.countDocuments();
  if (existingBatches > 0) {
    console.log(`[Seed] Batches already exist (${existingBatches}), skipping historical data.`);
    await mongoose.disconnect();
    console.log('\n[Seed] Complete (no changes to batches/readings).');
    return;
  }

  // ----- Batch 1: FBD-5-01, completed, no alarms, APPROVED -----
  const batch1Start = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
  const batch1End = new Date(batch1Start.getTime() + 5 * 60 * 1000); // 5 minutes

  const batch1 = await Batch.create({
    batchNo: 'FBD5-' + batch1Start.toISOString().slice(2, 10).replace(/-/g, '') + '-001',
    machineId: fbd5._id,
    machineTag: 'FBD-5-01',
    machineModel: 'FBD-5',
    product: 'Paracetamol 500',
    loadKg: 4.0,
    capacityKg: 5,
    startedAt: batch1Start,
    endedAt: batch1End,
    state: 'DRYING_COMPLETE',
    status: 'APPROVED',
    summary: {
      durationMinutes: 5.0,
      alarmCount: 0,
      validationErrorCount: 0,
      readingCount: 300,
      parameterStats: {
        inletTemp:  { min: 58.2, max: 62.1, avg: 60.1, count: 300 },
        outletTemp: { min: 38.5, max: 41.9, avg: 40.0, count: 300 },
        productTemp:{ min: 37.2, max: 42.3, avg: 39.5, count: 300 },
        airflow:    { min: 205,  max: 240,  avg: 221.4, count: 300 },
        diffPressure:{ min: 140, max: 165, avg: 152.3, count: 300 },
        inletHumidity:{ min: 32, max: 38,  avg: 34.8, count: 300 },
        blowerSpeed: { min: 1180, max: 1225, avg: 1201, count: 300 },
      },
      processResult: 'PROCESS OK',
    },
    qaDecision: {
      by: 'dev-qa-1',
      byName: 'QA Demo',
      at: new Date(batch1End.getTime() + 30 * 60 * 1000),
      decision: 'APPROVED',
      remarks: 'All parameters within specification. Batch approved for release.',
    },
  });
  console.log(`[Seed] Created batch: ${batch1.batchNo}`);

  // Create a few sample readings for batch 1
  for (let i = 0; i < 20; i++) {
    const ts = new Date(batch1Start.getTime() + i * 15000);
    await insertReading(fbd5._id, 'FBD-5-01', batch1.batchNo, ts, {
      inletTemp:    noise(60, 1),
      outletTemp:   noise(40, 0.8),
      productTemp:  noise(39.5, 0.5),
      airflow:      noise(220, 10),
      diffPressure: noise(150, 5),
      inletHumidity: noise(35, 1.5),
      blowerSpeed:  noise(1200, 20),
    });
  }
  console.log('[Seed] Created 20 sample readings for batch 1.');

  // Audit log for batch 1 events
  await insertAuditLog('BATCH_START', 'SYSTEM', 'System', 'SYSTEM', 'Batch', batch1.batchNo, {
    ts: batch1Start, newValue: { product: 'Paracetamol 500', loadKg: 4.0 },
  });
  await insertAuditLog('BATCH_END', 'SYSTEM', 'System', 'SYSTEM', 'Batch', batch1.batchNo, {
    ts: batch1End, newValue: { processResult: 'PROCESS OK', durationMinutes: 5.0 },
  });
  await insertAuditLog('QA_DECISION', 'dev-qa-1', 'QA Demo', 'QA', 'Batch', batch1.batchNo, {
    ts: new Date(batch1End.getTime() + 30 * 60 * 1000),
    newValue: { decision: 'APPROVED' },
    reason: 'All parameters within specification. Batch approved for release.',
  });

  // ----- Batch 2: FBD-5-01, completed, WITH ALARMS, DEVIATION, pending QA -----
  const batch2Start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const batch2End = new Date(batch2Start.getTime() + 5 * 60 * 1000);

  const batch2 = await Batch.create({
    batchNo: 'FBD5-' + batch2Start.toISOString().slice(2, 10).replace(/-/g, '') + '-001',
    machineId: fbd5._id,
    machineTag: 'FBD-5-01',
    machineModel: 'FBD-5',
    product: 'Ibuprofen 400',
    loadKg: 3.5,
    capacityKg: 5,
    startedAt: batch2Start,
    endedAt: batch2End,
    state: 'DRYING_COMPLETE',
    status: 'COMPLETE',
    summary: {
      durationMinutes: 5.0,
      alarmCount: 1,
      validationErrorCount: 2,
      readingCount: 298,
      parameterStats: {
        inletTemp:  { min: 58.5, max: 76.3, avg: 61.2, count: 298 },
        outletTemp: { min: 38.2, max: 42.0, avg: 39.8, count: 298 },
        productTemp:{ min: 37.0, max: 44.5, avg: 40.1, count: 298 },
        airflow:    { min: 210,  max: 235,  avg: 220.8, count: 298 },
        diffPressure:{ min: 142, max: 168, avg: 154.1, count: 298 },
        inletHumidity:{ min: 31, max: 39,  avg: 35.1, count: 298 },
        blowerSpeed: { min: 1182, max: 1218, avg: 1199, count: 298 },
      },
      processResult: 'DEVIATION',
    },
  });
  console.log(`[Seed] Created batch: ${batch2.batchNo}`);

  // Create alarm for batch 2
  const alarm2StartedAt = new Date(batch2Start.getTime() + 90000); // 1.5 min in
  const alarm2EndedAt = new Date(alarm2StartedAt.getTime() + 20000);
  const alarm2 = await Alarm.create({
    machineId: fbd5._id,
    machineTag: 'FBD-5-01',
    batchNo: batch2.batchNo,
    parameter: 'inletTemp',
    displayName: 'Inlet Air Temperature',
    unit: '°C',
    value: 76.3,
    limitMin: 50,
    limitMax: 70,
    severity: 'CRITICAL',
    startedAt: alarm2StartedAt,
    endedAt: alarm2EndedAt,
    peakValue: 76.3,
    consecutiveCount: 3,
    status: 'OPEN',
  });

  // Create validation error for batch 2
  {
    const prevHash = await getLastHash(ValidationError);
    const ts = new Date(batch2Start.getTime() + 60000);
    const payload = {
      ts, machineId: fbd5._id, machineTag: 'FBD-5-01',
      batchNo: batch2.batchNo, parameter: 'inletTemp',
      rejectedValue: null, reason: 'NULL_VALUE',
    };
    const hash = computeHash(payload, prevHash);
    await new ValidationError({ ...payload, prevHash, hash }).save();
  }

  await insertAuditLog('BATCH_START', 'SYSTEM', 'System', 'SYSTEM', 'Batch', batch2.batchNo, {
    ts: batch2Start, newValue: { product: 'Ibuprofen 400', loadKg: 3.5 },
  });
  await insertAuditLog('ALARM_RAISED', 'SYSTEM', 'System', 'SYSTEM', 'Alarm', alarm2._id.toString(), {
    ts: alarm2StartedAt,
    newValue: { parameter: 'inletTemp', value: 76.3, severity: 'CRITICAL' },
  });
  await insertAuditLog('BATCH_END', 'SYSTEM', 'System', 'SYSTEM', 'Batch', batch2.batchNo, {
    ts: batch2End, newValue: { processResult: 'DEVIATION', alarmCount: 1 },
  });
  console.log('[Seed] Created alarm and validation error for batch 2.');

  // ----- Batch 3: FBD-10-01, completed, no alarms, APPROVED -----
  const batch3Start = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const batch3End = new Date(batch3Start.getTime() + 5 * 60 * 1000);

  const batch3 = await Batch.create({
    batchNo: 'FBD10-' + batch3Start.toISOString().slice(2, 10).replace(/-/g, '') + '-001',
    machineId: fbd10._id,
    machineTag: 'FBD-10-01',
    machineModel: 'FBD-10',
    product: 'Paracetamol 500',
    loadKg: 8.0,
    capacityKg: 10,
    startedAt: batch3Start,
    endedAt: batch3End,
    state: 'DRYING_COMPLETE',
    status: 'APPROVED',
    summary: {
      durationMinutes: 5.0,
      alarmCount: 0,
      validationErrorCount: 0,
      readingCount: 300,
      parameterStats: {
        inletTemp:  { min: 58.8, max: 61.5, avg: 60.0, count: 300 },
        outletTemp: { min: 39.0, max: 41.5, avg: 40.1, count: 300 },
        productTemp:{ min: 38.0, max: 42.0, avg: 40.0, count: 300 },
        airflow:    { min: 435,  max: 465,  avg: 450.2, count: 300 },
        diffPressure:{ min: 165, max: 195, avg: 180.1, count: 300 },
        inletHumidity:{ min: 33, max: 37,  avg: 35.0, count: 300 },
        blowerSpeed: { min: 1480, max: 1520, avg: 1500, count: 300 },
      },
      processResult: 'PROCESS OK',
    },
    qaDecision: {
      by: 'dev-qa-1',
      byName: 'QA Demo',
      at: new Date(batch3End.getTime() + 20 * 60 * 1000),
      decision: 'APPROVED',
      remarks: 'Process within specification. Batch approved.',
    },
  });
  console.log(`[Seed] Created batch: ${batch3.batchNo}`);

  // Sample readings for batch 3
  for (let i = 0; i < 20; i++) {
    const ts = new Date(batch3Start.getTime() + i * 15000);
    await insertReading(fbd10._id, 'FBD-10-01', batch3.batchNo, ts, {
      inletTemp:    noise(60, 0.8),
      outletTemp:   noise(40.1, 0.7),
      productTemp:  noise(40.0, 0.5),
      airflow:      noise(450, 12),
      diffPressure: noise(180, 7),
      inletHumidity: noise(35, 1.2),
      blowerSpeed:  noise(1500, 25),
    });
  }

  await insertAuditLog('BATCH_START', 'SYSTEM', 'System', 'SYSTEM', 'Batch', batch3.batchNo, {
    ts: batch3Start, newValue: { product: 'Paracetamol 500', loadKg: 8.0 },
  });
  await insertAuditLog('BATCH_END', 'SYSTEM', 'System', 'SYSTEM', 'Batch', batch3.batchNo, {
    ts: batch3End, newValue: { processResult: 'PROCESS OK', durationMinutes: 5.0 },
  });
  await insertAuditLog('QA_DECISION', 'dev-qa-1', 'QA Demo', 'QA', 'Batch', batch3.batchNo, {
    ts: new Date(batch3End.getTime() + 20 * 60 * 1000),
    newValue: { decision: 'APPROVED' },
    reason: 'Process within specification. Batch approved.',
  });

  // System start log
  await insertAuditLog('SYSTEM_START', 'SYSTEM', 'System', 'SYSTEM', null, null, {
    ts: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    newValue: { event: 'Seed script initial setup' },
  });

  await mongoose.disconnect();
  console.log('\n[Seed] ✅ Seed complete! Created:');
  console.log('  - 2 machines (FBD-5-01, FBD-10-01)');
  console.log(`  - ${catalogEntries().length} parameter limits (per medicine)`);
  console.log('  - 3 historical batches');
  console.log('  - Sample readings, alarms, validation errors, audit logs');
}

seed().catch(err => {
  console.error('[Seed] Error:', err);
  mongoose.disconnect();
  process.exit(1);
});
