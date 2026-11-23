/**
 * readings.js — Sensor readings query routes (read-only).
 * Supports time-range filtering and downsampling for long ranges.
 */
const express = require('express');
const router = express.Router();
const Reading = require('../models/Reading');
const auth = require('../middleware/auth');
const { tagScope, machineScope } = auth;

/**
 * GET /api/readings
 * Query: machineId, from, to, limit (default 500), batchNo
 *
 * Downsampling: for ranges > 1 hour with many readings,
 * returns every Nth reading to keep response size manageable.
 */
router.get('/', auth, machineScope, async (req, res) => {
  try {
    const { machineId, batchNo, from, to, limit = 500 } = req.query;

    const filter = tagScope(req);
    if (!machineId) return res.status(400).json({ error: 'machineId is required for machine reading logs' });
    filter.machineId = machineId;
    if (batchNo) filter.batchNo = batchNo;
    if (from || to) {
      filter.ts = {};
      if (from) filter.ts.$gte = new Date(from);
      if (to) filter.ts.$lte = new Date(to);
    }

    const maxLimit = Math.min(parseInt(limit), 5000);

    // Count total matching documents for downsampling decision
    const totalCount = await Reading.countDocuments(filter);
    const downsampleFactor = totalCount > maxLimit ? Math.ceil(totalCount / maxLimit) : 1;

    let readings;
    if (downsampleFactor <= 1) {
      readings = await Reading.find(filter)
        .sort({ ts: 1 })
        .limit(maxLimit)
        .select('-__v -prevHash -hash')
        .lean();
    } else {
      // Simple downsampling: aggregate with $bucket or use modulo skip
      // Using find + filter in JS for simplicity (acceptable for prototype)
      const all = await Reading.find(filter)
        .sort({ ts: 1 })
        .select('-__v -prevHash -hash')
        .lean();
      readings = all.filter((_, i) => i % downsampleFactor === 0);
    }

    res.json({
      total: totalCount,
      returned: readings.length,
      downsampleFactor,
      readings,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
