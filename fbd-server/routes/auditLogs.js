/**
 * auditLogs.js — Audit trail query routes and integrity verification.
 * READ-ONLY. No create/update/delete routes.
 */
const express = require('express');
const router = express.Router();
const AuditLog = require('../models/AuditLog');
const Reading = require('../models/Reading');
const ValidationError = require('../models/ValidationError');
const auth = require('../middleware/auth');
const Machine = require('../models/Machine');
const { verifyChain, HASH_FIELDS } = require('../services/hashService');
const { logEvent } = require('../services/auditService');

// GET /api/audit — query audit logs
router.get('/', auth, async (req, res) => {
  try {
    const { userId, action, entity, from, to, machineId, page = 1, pageSize = 50 } = req.query;
    // Centralized audit access is explicitly granted by the Role permission.
    // Ordinary users without that permission retain only machine-scoped audit access.
    const canReadCentral = req.user.role === 'ADMIN' ||
      (Array.isArray(req.user.permissions) && req.user.permissions.includes('ACCESS_ADMIN_LOGBOOK'));
    if (!canReadCentral && (!machineId || !req.allowedTags)) return res.status(403).json({ error: 'ACCESS_ADMIN_LOGBOOK permission required for centralized audit access' });

    const filter = {};
    if (machineId) {
      const machine = await Machine.findById(machineId).select('tag').lean().catch(() => null);
      if (!machine) return res.status(404).json({ error: 'Machine not found' });
      if (req.allowedTags && !req.allowedTags.has(machine.tag)) return res.status(403).json({ error: 'Machine not assigned' });
      filter['newValue.machineTags'] = machine.tag;
    }
    if (userId) filter.userId = userId;
    if (action) filter.action = action;
    if (entity) filter.entity = entity;
    if (from || to) {
      filter.ts = {};
      if (from) filter.ts.$gte = new Date(from);
      if (to) filter.ts.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .sort({ ts: -1 })
      .skip(skip)
      .limit(parseInt(pageSize))
      .lean();

    res.json({ total, page: parseInt(page), pageSize: parseInt(pageSize), logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/audit/verify — Verify hash chain integrity for all collections.
 * Re-computes every hash and reports the first broken link.
 */
router.get('/verify', auth, (req, res, next) => req.user.role === 'ADMIN' ? next() : res.status(403).json({ error: 'ITADMIN only' }), async (req, res) => {
  try {
    const startTime = Date.now();

    const [readingResult, veResult, auditResult] = await Promise.all([
      verifyChain(Reading, ['ts', 'machineId', 'machineTag', 'batchNo', 'values']),
      verifyChain(ValidationError, ['ts', 'machineId', 'machineTag', 'batchNo', 'parameter', 'rejectedValue', 'reason']),
      verifyChain(AuditLog, ['ts', 'userId', 'userName', 'role', 'action', 'entity', 'entityId', 'oldValue', 'newValue', 'reason']),
    ]);

    const allIntact = readingResult.intact && veResult.intact && auditResult.intact;
    const durationMs = Date.now() - startTime;

    // Log the verification run
    await logEvent({
      action: 'INTEGRITY_VERIFIED',
      user: req.user,
      newValue: { allIntact, durationMs },
    });

    res.json({
      allIntact,
      durationMs,
      collections: {
        readings: readingResult,
        validationErrors: veResult,
        auditLogs: auditResult,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
