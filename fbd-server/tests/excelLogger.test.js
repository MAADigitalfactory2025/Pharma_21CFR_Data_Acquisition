const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const file = path.join(os.tmpdir(), `fbd_test_${Date.now()}.xlsx`);
process.env.EXCEL_LOG_PATH = file;
process.env.LOG_INTERVAL_MS = '150000';
const logger = require('../services/excelLogger');
const { catalogEntries } = require('../services/limitCatalog');

afterAll(() => fs.existsSync(file) && fs.unlinkSync(file));

test('logs a machine at most once per 2.5 minutes', () => {
  const t0 = Date.parse('2026-11-04T10:00:00Z');
  expect(logger.isDue('FBD-5-01', t0)).toBe(true);
  expect(logger.isDue('FBD-5-01', t0 + 1000)).toBe(false);
  expect(logger.isDue('FBD-5-01', t0 + 149000)).toBe(false);
  expect(logger.isDue('FBD-5-01', t0 + 150000)).toBe(true);
  expect(logger.isDue('FBD-10-01', t0 + 1000)).toBe(true); // independent per machine
});

test('appends rows to the Excel sheet', async () => {
  const row = (v) => ({ ts: new Date(), machineTag: 'FBD-450-01', batchNo: 'B1', values: { inletTemp: v } });
  await Promise.all([logger.appendRow(row(60)), logger.appendRow(row(61))]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('Readings');
  expect(ws.rowCount).toBe(3); // header + 2
  expect(ws.getRow(2).getCell(2).value).toBe('FBD-450-01');
});

test('limit catalog covers FBD-450 for every product and parameter', () => {
  expect(catalogEntries().filter((e) => e.machineModel === 'FBD-450')).toHaveLength(14);
});
