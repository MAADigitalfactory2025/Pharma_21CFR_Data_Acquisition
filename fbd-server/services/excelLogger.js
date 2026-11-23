/**
 * excelLogger.js — Throttled reading log. Each machine is written to
 * the Excel sheet (and the DB) at most once per LOG_INTERVAL_MS (default 60 seconds).
 * Live Socket.IO updates and alarm checks still run on every reading.
 */
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const COLUMNS = [
  ['Timestamp', 'ts'], ['Machine', 'machineTag'], ['Batch', 'batchNo'],
  ['Inlet Temp (°C)', 'inletTemp'], ['Outlet Temp (°C)', 'outletTemp'], ['Product Temp (°C)', 'productTemp'],
  ['Airflow (m³/h)', 'airflow'], ['Diff Pressure (Pa)', 'diffPressure'],
  ['Inlet Humidity (%RH)', 'inletHumidity'], ['Blower Speed (RPM)', 'blowerSpeed'],
];

const intervalMs = () => Number(process.env.LOG_INTERVAL_MS) || 60000;
const filePath = () => process.env.EXCEL_LOG_PATH || path.join(__dirname, '..', 'logs', 'fbd_readings.xlsx');

const lastLogged = new Map();
let queue = Promise.resolve(); // serialize writes so concurrent machines can't corrupt the file

/** True (and the clock restarts) when this machine is due for a logged reading. */
function isDue(machineTag, ts = new Date()) {
  const t = new Date(ts).getTime();
  const last = lastLogged.get(machineTag);
  if (last !== undefined && Math.abs(t - last) < intervalMs()) return false;
  lastLogged.set(machineTag, t);
  return true;
}

function appendRow({ ts, machineTag, batchNo, values }) {
  queue = queue.then(async () => {
    const file = filePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const wb = new ExcelJS.Workbook();
    let ws;
    if (fs.existsSync(file)) {
      await wb.xlsx.readFile(file);
      ws = wb.getWorksheet('Readings');
    }
    if (!ws) {
      ws = wb.addWorksheet('Readings');
      ws.columns = COLUMNS.map(([header, key]) => ({ header, key, width: 20 }));
      ws.getRow(1).font = { bold: true };
    }
    ws.addRow([new Date(ts), machineTag, batchNo || '', ...COLUMNS.slice(3).map(([, k]) => values[k] ?? '')]);
    await wb.xlsx.writeFile(file);
  }).catch((err) => console.error('[ExcelLogger]', err.message));
  return queue;
}

module.exports = { isDue, appendRow, filePath, _reset: () => lastLogged.clear() };
