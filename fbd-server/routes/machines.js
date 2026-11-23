/**
 * machines.js — Machine information routes (read-only).
 */
const express = require('express');
const router = express.Router();
const Machine = require('../models/Machine');
const ParameterLimit = require('../models/ParameterLimit');
const auth = require('../middleware/auth');
const { tagScope } = auth;
const canSee = (req, m) => !req.allowedTags || req.allowedTags.has(m.tag);
const { getActiveBatch } = require('../services/batchService');

// GET /api/machines — list all machines
router.get('/', auth, async (req, res) => {
  try {
    const machines = await Machine.find(tagScope(req, 'tag')).lean();
    res.json(machines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/machines/:id — single machine details
router.get('/:id', auth, async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id).lean();
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    if (!canSee(req, machine)) return res.status(403).json({ error: 'No access to this machine' });
    res.json(machine);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/machines/:id/limits — limits for the running medicine, or ?product=
router.get('/:id/limits', auth, async (req, res) => {
  try {
    const machine = await Machine.findById(req.params.id).lean();
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    if (!canSee(req, machine)) return res.status(403).json({ error: 'No access to this machine' });

    let product = typeof req.query.product === 'string' ? req.query.product.trim() : '';
    if (!product) {
      const batch = await getActiveBatch(machine._id);
      product = batch ? batch.product : '';
    }
    if (!product) return res.json([]);

    const limits = await ParameterLimit.find({
      machineModel: machine.model,
      product,
      isActive: true,
    }).lean();

    res.json(limits);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
