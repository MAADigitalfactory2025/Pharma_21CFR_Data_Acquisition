/**
 * limits.js — Parameter limit management (ADMIN only).
 *
 * Limits are NEVER overwritten.
 * A PUT creates a new version and deactivates the old one.
 * The reason for the change is mandatory.
 */
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const ParameterLimit = require('../models/ParameterLimit');
const Machine = require('../models/Machine');
const auth = require('../middleware/auth');
const roleGuard = require('../middleware/roleGuard');
const { logEvent } = require('../services/auditService');
const { invalidateLimitsCache } = require('../services/validationService');
const { SENSOR } = require('../services/limitCatalog');

const Proposal = require('../models/LimitChangeProposal');
const AuditLog = require('../models/AuditLog');
const { requirePermission } = require('../middleware/operationalPermission');

// Embed machine identifiers in the hash-protected event payload so each
// machine log can safely select only its own events.
async function machineAuditContext(machineModel) {
  const machines = await Machine.find({ model: machineModel }).select('_id tag').lean();
  return { machineModel, machineTags: machines.map(m => m.tag),
    machineIds: machines.map(m => String(m._id)) };
}

async function requireLimitMachineAccess(req, res, next) {
  try {
    if (!req.allowedTags) return next();
    const id = req.body.limitId || req.params.id;
    const limit = await ParameterLimit.findById(id).lean();
    if (!limit) return res.status(404).json({ error: 'Limit not found' });
    const machines = await Machine.find({ model: limit.machineModel }).select('tag').lean();
    if (!machines.some(m => req.allowedTags.has(m.tag))) return res.status(403).json({ error: 'Machine not assigned' });
    next();
  } catch (err) { return res.status(400).json({ error: 'Invalid limit ID' }); }
}

const proposalSchema = z.object({ limitId: z.string().min(1), proposedMin: z.number(), proposedMax: z.number(), reason: z.string().trim().min(10) })
  .refine(v => v.proposedMin < v.proposedMax, { message: 'Minimum must be lower than maximum' });
router.get('/proposals', auth, async (req, res) => {
  try {
    // Proposals are shared with authorized users of the corresponding machine model.
    // Never restrict the list to the submitter: a different employee must review it.
    let query = {};
    if (req.allowedTags) {
      const machines = await Machine.find({ tag: { $in: [...req.allowedTags] } }).select('model').lean();
      query = { machineModel: { $in: [...new Set(machines.map(m => m.model))] } };
    }
    res.set('Cache-Control', 'no-store');
    const proposals = await Proposal.find(query).sort({ createdAt: -1 }).limit(500).lean();
    // Resolve older proposals from the immutable audit trail without exposing user IDs
    // as display names. Keep IDs internally for authorization and traceability.
    const ids = [...new Set(proposals.flatMap(p => [p.proposedBy, p.reviewedBy]).filter(Boolean).map(String))];
    const logs = ids.length ? await AuditLog.find({ userId: { $in: ids }, userName: { $exists: true, $nin: ['', null] } })
      .sort({ ts: -1 }).select('userId userName').lean() : [];
    const names = new Map();
    for (const log of logs) if (!names.has(String(log.userId))) names.set(String(log.userId), log.userName);
    res.json(proposals.map(p => ({
      ...p,
      proposedByUsername: p.proposedByUsername || names.get(String(p.proposedBy)) || null,
      reviewedByUsername: p.reviewedByUsername || (p.reviewedBy && names.get(String(p.reviewedBy))) || null,
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/proposals', auth, requirePermission('MACHINE_PARAMETERS.PROPOSE_LIMIT_CHANGE'), requireLimitMachineAccess, async (req, res) => {
  const parsed = proposalSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid proposal', details: parsed.error.errors });
  try {
    const limit = await ParameterLimit.findById(parsed.data.limitId);
    if (!limit?.isActive) return res.status(404).json({ error: 'Active limit not found' });
    const proposal = await Proposal.create({ limitId: limit._id, machineModel: limit.machineModel,
      product: limit.product, parameter: limit.parameter, currentMin: limit.limitMin, currentMax: limit.limitMax,
      proposedMin: parsed.data.proposedMin, proposedMax: parsed.data.proposedMax,
      reason: parsed.data.reason, proposedBy: req.user.userId,
      proposedByUsername: req.user.userName || req.user.name || undefined });
    await logEvent({ action: 'LIMIT_CHANGE_PROPOSED', user: req.user, entity: 'LimitChangeProposal',
      entityId: String(proposal._id), newValue: { ...proposal.toObject(), ...(await machineAuditContext(limit.machineModel)) }, reason: proposal.reason });
    res.status(201).json(proposal);
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/proposals/:id/decision', auth, requirePermission('MACHINE_PARAMETERS.APPROVE_LIMIT_CHANGE'), async (req, res) => {
  if (!['APPROVED', 'REJECTED'].includes(req.body.decision) || typeof req.body.reason !== 'string' || req.body.reason.trim().length < 10)
    return res.status(400).json({ error: 'Decision and reason (10+ characters) required' });
  try {
    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
    if (proposal.status !== 'PENDING') return res.status(409).json({ error: 'Proposal already reviewed' });
    if (req.allowedTags) {
      const machines = await Machine.find({ model: proposal.machineModel }).select('tag').lean();
      if (!machines.some(m => req.allowedTags.has(m.tag))) return res.status(403).json({ error: 'Machine not assigned' });
    }
    if (String(proposal.proposedBy) === String(req.user.userId)) return res.status(403).json({ error: 'Proposer cannot approve own change' });
    const oldLimit = await ParameterLimit.findById(proposal.limitId);
    if (req.body.decision === 'APPROVED' && (!oldLimit?.isActive || oldLimit.limitMin !== proposal.currentMin || oldLimit.limitMax !== proposal.currentMax))
      return res.status(409).json({ error: 'Limits changed since proposal; submit a new proposal' });
    if (req.body.decision === 'APPROVED') {
      const replacement = new ParameterLimit({ ...oldLimit.toObject(), _id: undefined, isActive: true,
        limitMin: proposal.proposedMin, limitMax: proposal.proposedMax, version: oldLimit.version + 1,
        effectiveFrom: new Date(), effectiveTo: null, changedBy: req.user.userId, changeReason: proposal.reason });
      await replacement.save();
      oldLimit.isActive = false; oldLimit.effectiveTo = new Date(); await oldLimit.save();
      invalidateLimitsCache();
      await logEvent({ action: 'LIMIT_CHANGED', user: req.user, entity: 'ParameterLimit', entityId: String(replacement._id),
        oldValue: { min: oldLimit.limitMin, max: oldLimit.limitMax }, newValue: { min: replacement.limitMin, max: replacement.limitMax, version: replacement.version, proposalId: String(proposal._id), parameter: proposal.parameter, product: proposal.product, ...(await machineAuditContext(proposal.machineModel)) }, reason: proposal.reason });
    }
    proposal.status = req.body.decision; proposal.reviewedBy = req.user.userId;
    proposal.reviewedByUsername = req.user.userName || req.user.name || undefined;
    proposal.reviewedAt = new Date(); proposal.reviewReason = req.body.reason.trim(); await proposal.save();
    await logEvent({ action: 'LIMIT_PROPOSAL_REVIEWED', user: req.user, entity: 'LimitChangeProposal', entityId: String(proposal._id),
      newValue: { decision: proposal.status, parameter: proposal.parameter, product: proposal.product, currentMin: proposal.currentMin, currentMax: proposal.currentMax, proposedMin: proposal.proposedMin, proposedMax: proposal.proposedMax, proposedByUsername: proposal.proposedByUsername, ...(await machineAuditContext(proposal.machineModel)) }, reason: proposal.reviewReason });
    res.json(proposal);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/limits — active limits, optionally filtered by medicine and model
router.get('/', auth, async (req, res) => {
  try {
    const { machineModel, product, includeInactive } = req.query;
    const filter = {};
    if (machineModel) filter.machineModel = machineModel;
    if (product) filter.product = product;
    if (includeInactive !== 'true') {
      filter.isActive = true;
      filter.product = filter.product || { $exists: true, $nin: [null, ''] };
    }

    if (req.allowedTags) {
      const permitted = await Machine.find({ tag: { $in: [...req.allowedTags] } }).select('model').lean();
      filter.machineModel = { $in: [...new Set(permitted.map(m => m.model))] };
    }
    const limits = await ParameterLimit.find(filter)
      .sort({ product: 1, machineModel: 1, parameter: 1 })
      .lean();
    res.json(limits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/limits/:id — single limit with version history
router.get('/:id', auth, async (req, res) => {
  try {
    const limit = await ParameterLimit.findById(req.params.id).lean();
    if (!limit) return res.status(404).json({ error: 'Limit not found' });

    // Get version history for same model+parameter
    const history = await ParameterLimit.find({
      product: limit.product,
      machineModel: limit.machineModel,
      parameter: limit.parameter,
    }).sort({ version: -1 }).lean();

    res.json({ limit, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const createProductSchema = z.object({
  product: z.string().trim().min(2).max(80),
  machineModel: z.enum(['FBD-5', 'FBD-10', 'FBD-450']),
  copyFromProduct: z.string().trim().min(2).max(80),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});

// POST /api/limits — copy one medicine's bands onto a new medicine (ADMIN)
router.post('/', auth, roleGuard(['ADMIN']), async (req, res) => {
  try {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { product, machineModel, copyFromProduct, reason } = parsed.data;
    if (product.toLowerCase() === copyFromProduct.toLowerCase()) {
      return res.status(400).json({ error: 'Choose a different medicine to copy from' });
    }

    const already = await ParameterLimit.exists({ product, machineModel, isActive: true });
    if (already) {
      return res.status(409).json({ error: `${product} already has limits on ${machineModel}` });
    }

    const source = await ParameterLimit.find({
      product: copyFromProduct,
      machineModel,
      isActive: true,
    }).lean();
    if (source.length === 0) {
      return res.status(404).json({ error: `No active limits for ${copyFromProduct} on ${machineModel}` });
    }

    const created = [];
    for (const row of source) {
      const sensor = SENSOR[row.parameter] || {};
      const doc = await ParameterLimit.create({
        product,
        machineModel,
        parameter: row.parameter,
        unit: row.unit,
        displayName: row.displayName,
        validMin: sensor.validMin ?? row.validMin,
        validMax: sensor.validMax ?? row.validMax,
        limitMin: row.limitMin,
        limitMax: row.limitMax,
        severity: row.severity,
        version: 1,
        effectiveFrom: new Date(),
        isActive: true,
        changedBy: req.user.userId,
        changeReason: reason,
      });
      created.push(doc);
    }

    invalidateLimitsCache();
    await logEvent({
      action: 'LIMIT_CHANGED',
      user: req.user,
      entity: 'ParameterLimit',
      entityId: product,
      oldValue: { copyFromProduct, machineModel },
      newValue: { product, machineModel, parameters: created.length, ...(await machineAuditContext(machineModel)) },
      reason,
    });

    res.status(201).json({ status: 'ok', limits: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const updateLimitSchema = z.object({
  limitMin: z.number(),
  limitMax: z.number(),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
}).refine(d => d.limitMin < d.limitMax, { message: 'limitMin must be less than limitMax' });

// PUT /api/limits/:id — create new version (ADMIN only)
router.put('/:id', auth, requirePermission('MACHINE_PARAMETERS.MODIFY_LIMITS'), requireLimitMachineAccess, async (req, res) => {
  try {
    const parsed = updateLimitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const { limitMin, limitMax, reason } = parsed.data;
    const oldLimit = await ParameterLimit.findById(req.params.id);
    if (!oldLimit) return res.status(404).json({ error: 'Limit not found' });
    if (!oldLimit.isActive) return res.status(400).json({ error: 'Cannot update an inactive limit version' });

    // Deactivate old version
    oldLimit.isActive = false;
    oldLimit.effectiveTo = new Date();
    await oldLimit.save();

    // Create new version
    const newLimit = new ParameterLimit({
      product: oldLimit.product,
      machineModel: oldLimit.machineModel,
      parameter: oldLimit.parameter,
      unit: oldLimit.unit,
      displayName: oldLimit.displayName,
      validMin: oldLimit.validMin,
      validMax: oldLimit.validMax,
      limitMin,
      limitMax,
      severity: oldLimit.severity,
      version: oldLimit.version + 1,
      effectiveFrom: new Date(),
      isActive: true,
      changedBy: req.user.userId,
      changeReason: reason,
    });
    await newLimit.save();

    // Invalidate in-memory limits cache
    invalidateLimitsCache();

    // Audit log the change with old and new values
    await logEvent({
      action: 'LIMIT_CHANGED',
      user: req.user,
      entity: 'ParameterLimit',
      entityId: newLimit._id.toString(),
      oldValue: { limitMin: oldLimit.limitMin, limitMax: oldLimit.limitMax, version: oldLimit.version },
      newValue: { limitMin, limitMax, version: newLimit.version, parameter: oldLimit.parameter, product: oldLimit.product, ...(await machineAuditContext(oldLimit.machineModel)) },
      reason,
    });

    res.json({ status: 'ok', newLimit, oldLimit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
