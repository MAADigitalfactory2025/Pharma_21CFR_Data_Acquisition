/**
 * limitCatalog.js — Process limits keyed by medicine and machine model.
 *
 * Temperature and humidity bands come from the product.
 * Airflow, differential pressure, and blower speed stay inside each
 * machine's equipment envelope, and can still differ by product.
 * Sensor ranges (validMin/validMax) are the same for every medicine
 * on a given machine model.
 */
const ParameterLimit = require('../models/ParameterLimit');

const PRODUCTS = ['Paracetamol 500', 'Ibuprofen 400'];

const SENSOR = {
  inletTemp:     { unit: '°C',   displayName: 'Inlet Air Temperature',  validMin: 0, validMax: 150,  severity: 'CRITICAL' },
  outletTemp:    { unit: '°C',   displayName: 'Outlet Air Temperature', validMin: 0, validMax: 150,  severity: 'MAJOR' },
  productTemp:   { unit: '°C',   displayName: 'Product Temperature',    validMin: 0, validMax: 150,  severity: 'CRITICAL' },
  airflow:       { unit: 'm³/h', displayName: 'Airflow',                validMin: 0, validMax: 1500, severity: 'MAJOR' },
  diffPressure:  { unit: 'Pa',   displayName: 'Differential Pressure',  validMin: 0, validMax: 1000, severity: 'MAJOR' },
  inletHumidity: { unit: '%RH',  displayName: 'Inlet Humidity',         validMin: 0, validMax: 100,  severity: 'MAJOR' },
  blowerSpeed:   { unit: 'RPM',  displayName: 'Blower Speed',           validMin: 0, validMax: 3000, severity: 'MAJOR' },
};

/** Process bands. Same medicine, different bowl size: airflow and blower change. */
const PROCESS = {
  'Paracetamol 500': {
    'FBD-5': {
      inletTemp: [50, 70], outletTemp: [30, 50], productTemp: [35, 45],
      airflow: [150, 300], diffPressure: [50, 250], inletHumidity: [10, 60], blowerSpeed: [1000, 1400],
    },
    'FBD-10': {
      inletTemp: [50, 70], outletTemp: [30, 50], productTemp: [35, 45],
      airflow: [300, 600], diffPressure: [50, 300], inletHumidity: [10, 60], blowerSpeed: [1200, 1800],
    },
    'FBD-450': {
      inletTemp: [50, 70], outletTemp: [30, 50], productTemp: [35, 45],
      airflow: [900, 1400], diffPressure: [100, 500], inletHumidity: [10, 60], blowerSpeed: [1500, 2500],
    },
  },
  'Ibuprofen 400': {
    'FBD-5': {
      inletTemp: [45, 60], outletTemp: [28, 45], productTemp: [32, 42],
      airflow: [160, 280], diffPressure: [40, 220], inletHumidity: [15, 50], blowerSpeed: [950, 1300],
    },
    'FBD-10': {
      inletTemp: [45, 60], outletTemp: [28, 45], productTemp: [32, 42],
      airflow: [280, 520], diffPressure: [40, 260], inletHumidity: [15, 50], blowerSpeed: [1100, 1650],
    },
    'FBD-450': {
      inletTemp: [45, 60], outletTemp: [28, 45], productTemp: [32, 42],
      airflow: [850, 1300], diffPressure: [100, 450], inletHumidity: [15, 50], blowerSpeed: [1400, 2400],
    },
  },
};

function catalogEntries() {
  const rows = [];
  for (const product of Object.keys(PROCESS)) {
    for (const machineModel of Object.keys(PROCESS[product])) {
      const bands = PROCESS[product][machineModel];
      for (const parameter of Object.keys(SENSOR)) {
        const [limitMin, limitMax] = bands[parameter];
        rows.push({
          product,
          machineModel,
          parameter,
          limitMin,
          limitMax,
          ...SENSOR[parameter],
        });
      }
    }
  }
  return rows;
}

function hasProduct(doc) {
  return typeof doc.product === 'string' && doc.product.trim() !== '';
}

/**
 * Create missing medicine+model limits and retire legacy rows that
 * applied one band to every product. Existing product rows are left as-is.
 */
async function ensureProductLimits() {
  const legacy = await ParameterLimit.find({
    isActive: true,
    $or: [{ product: { $exists: false } }, { product: null }, { product: '' }],
  });

  const legacyByKey = new Map();
  for (const row of legacy) {
    legacyByKey.set(`${row.machineModel}|${row.parameter}`, row);
  }

  let created = 0;
  for (const entry of catalogEntries()) {
    const exists = await ParameterLimit.exists({
      product: entry.product,
      machineModel: entry.machineModel,
      parameter: entry.parameter,
      isActive: true,
    });
    if (exists) continue;

    const legacyRow = legacyByKey.get(`${entry.machineModel}|${entry.parameter}`);
    const useLegacyBand = entry.product === 'Paracetamol 500' && legacyRow;
    await ParameterLimit.create({
      ...entry,
      limitMin: useLegacyBand ? legacyRow.limitMin : entry.limitMin,
      limitMax: useLegacyBand ? legacyRow.limitMax : entry.limitMax,
      version: 1,
      effectiveFrom: new Date(),
      isActive: true,
      changedBy: 'SYSTEM',
      changeReason: useLegacyBand
        ? 'Split the shared machine limit onto this medicine'
        : 'Initial medicine-specific process limit',
    });
    created += 1;
  }

  let retired = 0;
  if (legacy.length > 0) {
    const result = await ParameterLimit.updateMany(
      { _id: { $in: legacy.map((row) => row._id) } },
      { $set: { isActive: false, effectiveTo: new Date(), changeReason: 'Replaced by medicine-specific limits' } }
    );
    retired = result.modifiedCount || 0;
  }

  return { created, retired };
}

module.exports = {
  PRODUCTS,
  SENSOR,
  catalogEntries,
  ensureProductLimits,
  hasProduct,
};
