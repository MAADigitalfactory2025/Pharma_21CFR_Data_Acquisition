/**
 * batches.js — Batch query and QA decision routes.
 *
 * Read routes: open to OPERATOR, QA, ADMIN
 * QA decision: QA and ADMIN only
 */
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const Batch = require('../models/Batch');
const Alarm = require('../models/Alarm');
const ValidationError = require('../models/ValidationError');
const Reading = require('../models/Reading');
const auth = require('../middleware/auth');
const { tagScope, batchScope } = auth;
const roleGuard = require('../middleware/roleGuard');
const { logEvent } = require('../services/auditService');
const { liveSummary } = require('../services/batchService');
const { generateBatchPDF } = require('../services/reportService');

const Machine = require('../models/Machine');
const { startBatch, endBatch, getActiveBatch } = require('../services/batchService');
const { requirePermission, requireMachineAccess } = require('../middleware/operationalPermission');

const newBatchSchema = z.object({
  machineId: z.string().min(1), product: z.string().trim().min(2).max(100),
  loadKg: z.number().positive(),
});
// Registering a batch immediately activates reading association; it does NOT control the PLC.
router.post('/', auth, requirePermission('BATCH_MANAGEMENT.CREATE_BATCH'), requireMachineAccess, async (req, res) => {
  const parsed = newBatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid batch details', details: parsed.error.errors });
  try {
    const machine = req.targetMachine;
    if (parsed.data.loadKg > machine.capacityKg) return res.status(400).json({ error: 'Load exceeds machine capacity' });
    if (await getActiveBatch(machine._id)) return res.status(409).json({ error: 'Close the existing batch before creating another' });
    const batch = await startBatch({ machine, product: parsed.data.product, loadKg: parsed.data.loadKg, ts: new Date() });
    await Machine.findByIdAndUpdate(machine._id, { currentBatchNo: batch.batchNo });
    await logEvent({ action: 'BATCH_CREATED', user: req.user, entity: 'Batch', entityId: batch.batchNo,
      newValue: { machineTag: machine.tag, product: batch.product, loadKg: batch.loadKg } });
    req.app.get('io')?.emit('batchStart', { machineTag: machine.tag, batch });
    res.status(201).json({ batch });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:batchNo/close', auth, batchScope, requirePermission('BATCH_MANAGEMENT.CLOSE_BATCH'), async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchNo: req.params.batchNo });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });
    if (batch.state !== 'RUNNING') return res.status(409).json({ error: 'Batch is already closed' });
    const closed = await endBatch({ batchNo: batch.batchNo, ts: new Date() });
    await Machine.findByIdAndUpdate(batch.machineId, { currentBatchNo: null });
    await logEvent({ action: 'BATCH_CLOSED', user: req.user, entity: 'Batch', entityId: batch.batchNo,
      newValue: { machineTag: batch.machineTag, status: 'COMPLETE' } });
    req.app.get('io')?.emit('batchEnd', { machineTag: batch.machineTag, batch: closed });
    res.json({ batch: closed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/batches — list batches with optional filters
router.get('/', auth, async (req, res) => {
  try {
    const { machineId, status, state, from, to, page = 1, pageSize = 20 } = req.query;

    const filter = tagScope(req);
    if (machineId) filter.machineId = machineId;
    if (status) filter.status = status;
    if (state) filter.state = state;
    if (from || to) {
      filter.startedAt = {};
      if (from) filter.startedAt.$gte = new Date(from);
      if (to) filter.startedAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const total = await Batch.countDocuments(filter);
    const batches = await Batch.find(filter)
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(parseInt(pageSize))
      .lean();

    res.json({ total, page: parseInt(page), pageSize: parseInt(pageSize), batches });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/batches/:batchNo — single batch with alarms and validation errors
router.get('/:batchNo', auth, batchScope, async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchNo: req.params.batchNo })
      .populate('machineId', 'tag name model capacityKg location')
      .lean();

    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const alarms = await Alarm.find({ batchNo: batch.batchNo }).sort({ startedAt: 1 }).lean();
    const validationErrors = await ValidationError.find({ batchNo: batch.batchNo })
      .sort({ ts: 1 }).lean();

    // A running batch has no stored summary yet. Build one from readings so far.
    if (batch.status === 'RUNNING' || !batch.summary) {
      batch.summary = await liveSummary(batch, {
        alarmCount: alarms.length,
        validationErrorCount: validationErrors.length,
      });
    }

    res.json({ batch, alarms, validationErrors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/batches/:batchNo/report — PDF batch report
router.get('/:batchNo/report', auth, batchScope, async (req, res) => {
  try {
    const pdf = await generateBatchPDF(req.params.batchNo);

    await logEvent({
      action: 'REPORT_GENERATED',
      user: req.user,
      entity: 'Batch',
      entityId: req.params.batchNo,
      newValue: { format: 'PDF' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="batch-${req.params.batchNo}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/batches/:batchNo/decision — QA approve or reject
const decisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  remarks: z.string().min(5, 'Remarks must be at least 5 characters'),
});

router.post('/:batchNo/decision', auth, batchScope, roleGuard(['QA', 'ADMIN']), async (req, res) => {
  try {
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { decision, remarks } = parsed.data;
    const batch = await Batch.findOne({ batchNo: req.params.batchNo });
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    if (batch.status === 'RUNNING') {
      return res.status(400).json({ error: 'Cannot review a batch that is still running' });
    }

    if (batch.status === 'APPROVED' || batch.status === 'REJECTED') {
      return res.status(400).json({ error: `Batch already ${batch.status}` });
    }

    const oldStatus = batch.status;
    batch.status = decision;
    batch.qaDecision = {
      by: req.user.userId,
      byName: req.user.name,
      at: new Date(),
      decision,
      remarks,
    };
    await batch.save();

    // Audit log the QA decision (electronic signature equivalent)
    await logEvent({
      action: 'QA_DECISION',
      user: req.user,
      entity: 'Batch',
      entityId: batch.batchNo,
      oldValue: { status: oldStatus },
      newValue: { status: decision, remarks },
      reason: remarks,
    });

    res.json({ status: 'ok', batch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
