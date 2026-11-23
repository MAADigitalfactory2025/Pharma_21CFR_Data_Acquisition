/**
 * alarms.js — Alarm query and QA review routes.
 */
const express = require('express');
const router = express.Router();
const { z } = require('zod');

const Alarm = require('../models/Alarm');
const auth = require('../middleware/auth');
const { tagScope } = auth;
const roleGuard = require('../middleware/roleGuard');
const { logEvent } = require('../services/auditService');

// GET /api/alarms
router.get('/', auth, async (req, res) => {
  try {
    const { machineId, status, severity, batchNo, from, to, page = 1, pageSize = 50 } = req.query;

    const filter = tagScope(req);
    if (machineId) filter.machineId = machineId;
    if (status) filter.status = status;
    if (severity) filter.severity = severity;
    if (batchNo) filter.batchNo = batchNo;
    if (from || to) {
      filter.startedAt = {};
      if (from) filter.startedAt.$gte = new Date(from);
      if (to) filter.startedAt.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const total = await Alarm.countDocuments(filter);
    const alarms = await Alarm.find(filter)
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(parseInt(pageSize))
      .lean();

    res.json({ total, page: parseInt(page), pageSize: parseInt(pageSize), alarms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/alarms/:id/review — QA reviews an alarm
const reviewSchema = z.object({
  remarks: z.string().min(5, 'Remarks are required (min 5 characters)'),
});

router.post('/:id/review', auth, roleGuard(['QA', 'ADMIN']), async (req, res) => {
  try {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.errors });
    }

    const alarm = await Alarm.findById(req.params.id);
    if (!alarm) return res.status(404).json({ error: 'Alarm not found' });

    const oldStatus = alarm.status;
    alarm.status = 'REVIEWED';
    alarm.reviewedBy = req.user.name;
    alarm.reviewedAt = new Date();
    alarm.remarks = parsed.data.remarks;
    await alarm.save();

    await logEvent({
      action: 'ALARM_REVIEWED',
      user: req.user,
      entity: 'Alarm',
      entityId: alarm._id.toString(),
      oldValue: { status: oldStatus },
      newValue: { status: 'REVIEWED', remarks: parsed.data.remarks },
      reason: parsed.data.remarks,
    });

    res.json({ status: 'ok', alarm });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
