/**
 * reports.js — Report generation routes (PDF + Excel by machine + date range).
 */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { machineScope, batchScope } = auth;
const { generateRangeExcel } = require('../services/reportService');
const { logEvent } = require('../services/auditService');
const Machine = require('../models/Machine');
const { requirePermission } = require('../middleware/operationalPermission');

// GET /api/reports/excel?machineId=&from=&to=
router.get('/excel', auth, requirePermission('GENERATE_EXCEL_REPORT'), machineScope, async (req, res) => {
  try {
    const { machineId, from, to } = req.query;
    if (!machineId || !from || !to) {
      return res.status(400).json({ error: 'machineId, from, and to are required' });
    }

    const machine = await Machine.findById(machineId).lean();
    if (!machine) return res.status(404).json({ error: 'Machine not found' });

    const buffer = await generateRangeExcel(machineId, new Date(from), new Date(to));

    await logEvent({
      action: 'REPORT_EXPORTED',
      user: req.user,
      entity: 'Machine',
      entityId: machineId,
      newValue: { format: 'Excel', from, to },
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="fbd-report-${machine.tag}-${from.slice(0, 10)}-to-${to.slice(0, 10)}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/pdf/:batchNo (alias for /api/batches/:batchNo/report)
router.get('/pdf/:batchNo', auth, batchScope, async (req, res) => {
  try {
    const { generateBatchPDF } = require('../services/reportService');
    const pdf = await generateBatchPDF(req.params.batchNo);

    await logEvent({
      action: 'REPORT_EXPORTED',
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

module.exports = router;
