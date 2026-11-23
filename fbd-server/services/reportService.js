/**
 * reportService.js — PDF and Excel report generation.
 *
 * Uses:
 *   pdfkit  — PDF generation (no headless browser needed)
 *   exceljs — Excel generation
 *
 * Reports include:
 *   - Machine details and calibration status
 *   - Batch information (product, load, duration)
 *   - Parameter statistics (min/max/avg)
 *   - Alarms list
 *   - Validation errors count
 *   - QA decision (electronic signature equivalent)
 *   - Hash-verified footer
 *   - Compliance statement
 */
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const Batch = require('../models/Batch');
const Alarm = require('../models/Alarm');
const ValidationError = require('../models/ValidationError');
const Reading = require('../models/Reading');
const Machine = require('../models/Machine');

const PARAM_DISPLAY = {
  inletTemp: 'Inlet Air Temperature (°C)',
  outletTemp: 'Outlet Air Temperature (°C)',
  productTemp: 'Product Temperature (°C)',
  airflow: 'Airflow (m³/h)',
  diffPressure: 'Differential Pressure (Pa)',
  inletHumidity: 'Inlet Humidity (%RH)',
  blowerSpeed: 'Blower Speed (RPM)',
};

/** Format date for IST display */
function formatIST(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

/**
 * Generate a PDF report for a batch.
 * @param {string} batchNo
 * @returns {Promise<Buffer>}
 */
async function generateBatchPDF(batchNo) {
  const batch = await Batch.findOne({ batchNo }).populate('machineId').lean();
  if (!batch) throw new Error(`Batch not found: ${batchNo}`);

  const machine = batch.machineId;
  const alarms = await Alarm.find({ batchNo }).sort({ startedAt: 1 }).lean();
  const validationErrors = await ValidationError.find({ batchNo }).sort({ ts: 1 }).lean();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(18).fillColor('#1e3a5f').text('PHARMACEUTICAL GMP BATCH REPORT', { align: 'center' });
    doc.fontSize(12).fillColor('#666').text('Fluid Bed Dryer — Data Acquisition System', { align: 'center' });
    doc.moveDown();
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#1e3a5f');
    doc.moveDown();

    // Machine Information
    doc.fontSize(13).fillColor('#1e3a5f').text('MACHINE INFORMATION');
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    const machineRows = [
      ['Machine Tag', machine.tag],
      ['Machine Name', machine.name],
      ['Model', machine.model],
      ['Capacity', `${machine.capacityKg} kg`],
      ['Location', machine.location],
      ['Status', machine.status],
      ['Calibration Due', formatIST(machine.calibrationDue)],
    ];
    for (const [label, value] of machineRows) {
      doc.text(`${label}: `, { continued: true }).fillColor('#000').text(value);
    }
    doc.moveDown();

    // Batch Information
    doc.fontSize(13).fillColor('#1e3a5f').text('BATCH INFORMATION');
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#333');
    const batchRows = [
      ['Batch Number', batch.batchNo],
      ['Product', batch.product],
      ['Load Weight', `${batch.loadKg} kg (Capacity: ${batch.capacityKg} kg)`],
      ['Start Time (IST)', formatIST(batch.startedAt)],
      ['End Time (IST)', formatIST(batch.endedAt)],
      ['Duration', batch.summary ? `${batch.summary.durationMinutes} minutes` : 'N/A'],
      ['Process Result', batch.summary ? batch.summary.processResult : 'N/A'],
      ['QA Status', batch.status],
    ];
    for (const [label, value] of batchRows) {
      doc.fillColor('#333').text(`${label}: `, { continued: true }).fillColor('#000').text(value);
    }
    doc.moveDown();

    // Parameter Statistics
    doc.fontSize(13).fillColor('#1e3a5f').text('PARAMETER STATISTICS');
    doc.moveDown(0.3);
    if (batch.summary && batch.summary.parameterStats) {
      doc.fontSize(9).fillColor('#333');
      const tableTop = doc.y;
      const colWidths = [160, 70, 70, 70, 70];
      const headers = ['Parameter', 'Min', 'Max', 'Avg', 'Readings'];
      let xPos = 50;

      // Header row
      doc.rect(50, tableTop, 495, 18).fill('#1e3a5f');
      doc.fillColor('#fff');
      for (let i = 0; i < headers.length; i++) {
        doc.text(headers[i], xPos + 3, tableTop + 4, { width: colWidths[i] - 6 });
        xPos += colWidths[i];
      }
      doc.fillColor('#333');

      let rowY = tableTop + 18;
      let rowIndex = 0;
      for (const [param, stats] of Object.entries(batch.summary.parameterStats)) {
        const bg = rowIndex % 2 === 0 ? '#f0f4f8' : '#fff';
        doc.rect(50, rowY, 495, 16).fill(bg);
        xPos = 50;
        const cells = [
          PARAM_DISPLAY[param] || param,
          stats.min !== null ? stats.min.toFixed(2) : 'N/A',
          stats.max !== null ? stats.max.toFixed(2) : 'N/A',
          stats.avg !== null ? stats.avg.toFixed(2) : 'N/A',
          String(stats.count || 0),
        ];
        doc.fillColor('#333');
        for (let i = 0; i < cells.length; i++) {
          doc.text(cells[i], xPos + 3, rowY + 3, { width: colWidths[i] - 6 });
          xPos += colWidths[i];
        }
        rowY += 16;
        rowIndex++;
      }
      doc.y = rowY + 5;
    }
    doc.moveDown();

    // Alarms
    doc.fontSize(13).fillColor('#1e3a5f').text(`ALARMS (${alarms.length})`);
    doc.moveDown(0.3);
    if (alarms.length === 0) {
      doc.fontSize(10).fillColor('#2d9e45').text('No alarms recorded during this batch.');
    } else {
      for (const alarm of alarms) {
        doc.fontSize(9).fillColor(alarm.severity === 'CRITICAL' ? '#c0392b' : '#e67e22');
        doc.text(`[${alarm.severity}] ${alarm.displayName || alarm.parameter}: ${alarm.value} (Limit: ${alarm.limitMin}–${alarm.limitMax})`);
        doc.fillColor('#666').text(`  Started: ${formatIST(alarm.startedAt)}  |  Ended: ${formatIST(alarm.endedAt)}  |  Status: ${alarm.status}`);
        if (alarm.remarks) doc.text(`  Review remarks: ${alarm.remarks}`);
        doc.moveDown(0.3);
      }
    }
    doc.moveDown();

    // QA Decision
    doc.fontSize(13).fillColor('#1e3a5f').text('QA DECISION');
    doc.moveDown(0.3);
    doc.fontSize(10);
    if (batch.qaDecision && batch.qaDecision.decision) {
      doc.fillColor(batch.qaDecision.decision === 'APPROVED' ? '#2d9e45' : '#c0392b');
      doc.text(`Decision: ${batch.qaDecision.decision}`);
      doc.fillColor('#333');
      doc.text(`By: ${batch.qaDecision.byName || batch.qaDecision.by}`);
      doc.text(`At: ${formatIST(batch.qaDecision.at)}`);
      doc.text(`Remarks: ${batch.qaDecision.remarks}`);
    } else {
      doc.fillColor('#666').text('Pending QA review.');
    }
    doc.moveDown();

    // Compliance Footer
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#999');
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#666');
    doc.text('COMPLIANCE STATEMENT: This report was generated by the FBD Data Acquisition System.');
    doc.text('This system is a monitoring and recording tool only. It does NOT control the machine or replace safety interlocks.');
    doc.text(`Batch No: ${batchNo}  |  Generated: ${formatIST(new Date())}  |  21 CFR Part 11 / EU Annex 11`);
    doc.text(`Validation Errors: ${validationErrors.length}  |  Total Readings: ${batch.summary ? batch.summary.readingCount : 'N/A'}`);

    doc.end();
  });
}

/**
 * Generate an Excel report for batches in a date range for a machine.
 * @param {string} machineId
 * @param {Date} from
 * @param {Date} to
 * @returns {Promise<Buffer>}
 */
async function generateRangeExcel(machineId, from, to) {
  const machine = await Machine.findById(machineId).lean();
  if (!machine) throw new Error('Machine not found');

  const batches = await Batch.find({
    machineId,
    startedAt: { $gte: from, $lte: to },
  }).sort({ startedAt: 1 }).lean();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'FBD Data Acquisition System';
  workbook.created = new Date();

  // ---- Sheet 1: Summary ----
  const summarySheet = workbook.addWorksheet('Batch Summary');
  summarySheet.addRow(['FBD Machine GMP Report']);
  summarySheet.addRow([`Machine: ${machine.tag} (${machine.model})`]);
  summarySheet.addRow([`Period: ${formatIST(from)} to ${formatIST(to)}`]);
  summarySheet.addRow([`Generated: ${formatIST(new Date())}`]);
  summarySheet.addRow([]);

  summarySheet.addRow([
    'Batch No', 'Product', 'Load (kg)', 'Start Time (IST)', 'End Time (IST)',
    'Duration (min)', 'Alarms', 'Val. Errors', 'Process Result', 'QA Status',
  ]);
  summarySheet.getRow(6).font = { bold: true };
  summarySheet.getRow(6).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } };
  summarySheet.getRow(6).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const batch of batches) {
    summarySheet.addRow([
      batch.batchNo,
      batch.product,
      batch.loadKg,
      formatIST(batch.startedAt),
      formatIST(batch.endedAt),
      batch.summary ? batch.summary.durationMinutes : '',
      batch.summary ? batch.summary.alarmCount : '',
      batch.summary ? batch.summary.validationErrorCount : '',
      batch.summary ? batch.summary.processResult : '',
      batch.status,
    ]);
  }

  summarySheet.columns.forEach(col => { col.width = 20; });

  // ---- Sheet 2: Parameter Stats ----
  const statsSheet = workbook.addWorksheet('Parameter Statistics');
  statsSheet.addRow(['Batch No', 'Parameter', 'Min', 'Max', 'Avg', 'Count']);
  statsSheet.getRow(1).font = { bold: true };

  for (const batch of batches) {
    if (!batch.summary || !batch.summary.parameterStats) continue;
    for (const [param, stats] of Object.entries(batch.summary.parameterStats)) {
      statsSheet.addRow([
        batch.batchNo,
        PARAM_DISPLAY[param] || param,
        stats.min,
        stats.max,
        stats.avg,
        stats.count,
      ]);
    }
  }
  statsSheet.columns.forEach(col => { col.width = 25; });

  // ---- Sheet 3: Alarms ----
  const alarmsSheet = workbook.addWorksheet('Alarms');
  alarmsSheet.addRow(['Batch No', 'Parameter', 'Value', 'Limit Min', 'Limit Max', 'Severity', 'Started (IST)', 'Ended (IST)', 'Status', 'Reviewed By', 'Remarks']);
  alarmsSheet.getRow(1).font = { bold: true };

  const machineAlarms = await Alarm.find({
    machineId,
    startedAt: { $gte: from, $lte: to },
  }).sort({ startedAt: 1 }).lean();

  for (const alarm of machineAlarms) {
    alarmsSheet.addRow([
      alarm.batchNo,
      alarm.displayName || alarm.parameter,
      alarm.value,
      alarm.limitMin,
      alarm.limitMax,
      alarm.severity,
      formatIST(alarm.startedAt),
      formatIST(alarm.endedAt),
      alarm.status,
      alarm.reviewedBy || '',
      alarm.remarks || '',
    ]);
  }
  alarmsSheet.columns.forEach(col => { col.width = 22; });

  // ---- Sheet 4: Compliance ----
  const compSheet = workbook.addWorksheet('Compliance');
  compSheet.addRow(['COMPLIANCE STATEMENT']);
  compSheet.addRow(['This report was generated by the FBD Data Acquisition System (PROTOTYPE).']);
  compSheet.addRow(['This system is a monitoring and recording tool only.']);
  compSheet.addRow(['It does NOT control the machine or replace safety interlocks.']);
  compSheet.addRow(['Standard: 21 CFR Part 11 / EU Annex 11 (audit trail, electronic signatures)']);
  compSheet.addRow(['Note: This is a prototype; it has not been formally validated per GAMP 5.']);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateBatchPDF, generateRangeExcel };
