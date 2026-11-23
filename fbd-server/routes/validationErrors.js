/**
 * validationErrors.js — Validation error query routes (read-only).
 */
const express = require('express');
const router = express.Router();
const ValidationError = require('../models/ValidationError');
const auth = require('../middleware/auth');
const { tagScope } = auth;

// GET /api/validation-errors
router.get('/', auth, async (req, res) => {
  try {
    const { machineId, batchNo, reason, from, to, page = 1, pageSize = 50 } = req.query;

    const filter = tagScope(req);
    if (machineId) filter.machineId = machineId;
    if (batchNo) filter.batchNo = batchNo;
    if (reason) filter.reason = reason;
    if (from || to) {
      filter.ts = {};
      if (from) filter.ts.$gte = new Date(from);
      if (to) filter.ts.$lte = new Date(to);
    }

    const skip = (parseInt(page) - 1) * parseInt(pageSize);
    const total = await ValidationError.countDocuments(filter);
    const errors = await ValidationError.find(filter)
      .sort({ ts: -1 })
      .skip(skip)
      .limit(parseInt(pageSize))
      .select('-prevHash -hash')
      .lean();

    res.json({ total, page: parseInt(page), pageSize: parseInt(pageSize), errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
