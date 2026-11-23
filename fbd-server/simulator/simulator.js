/**
 * simulator.js — FBD Machine PLC Simulator
 *
 * Simulates BOTH FBD-5-01 and FBD-10-01 independently.
 * Each machine runs a full realistic drying profile:
 *   IDLE -> batch load (load cell message) -> RUNNING
 *   -> ramp inlet temp -> hold -> product temp rises -> outlet follows
 *   -> DRYING_COMPLETE -> IDLE -> (repeat)
 *
 * Sends data via HTTP POST to the server's ingestion API.
 *
 * CLI FLAGS:
 *   --fault=spike      Inject a temperature spike on FBD-5-01
 *   --fault=sensor     Inject a null/stuck sensor fault on FBD-10-01
 *   --fault=overload   Send an overloaded batch on FBD-5-01 (6kg > 5kg limit)
 *   --fault=backfill   Simulate a 2-minute offline gap and replay with original timestamps
 *   --machine=FBD-5-01 Target a specific machine (default: both)
 *   --duration=300000  Override batch duration in ms (default: 300000 = 5 min)
 *
 * Example:
 *   node simulator.js --fault=spike
 *   node simulator.js --fault=overload --machine=FBD-5-01
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const http = require('http');
const url = require('url');

const SERVER_URL = process.env.SIMULATOR_SERVER_URL || `http://localhost:${process.env.PORT || 3001}`;
const API_KEY = process.env.API_KEY || 'fbd_ingest_api_key_2024';
const READING_INTERVAL_MS = parseInt(process.env.READING_INTERVAL_MS) || 1000;
const BATCH_DURATION_MS = parseInt(process.env.SIMULATOR_BATCH_DURATION_MS) || 300000; // 5 minutes

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [k, v] = arg.replace('--', '').split('=');
  acc[k] = v || true;
  return acc;
}, {});

const FAULT = args.fault || null;
const TARGET_MACHINE = args.machine || null;
const DURATION = parseInt(args.duration) || BATCH_DURATION_MS;

console.log(`[Simulator] Starting FBD Machine Simulator`);
console.log(`[Simulator] Server: ${SERVER_URL}`);
console.log(`[Simulator] Batch duration: ${DURATION / 1000}s`);
console.log(`[Simulator] Fault injection: ${FAULT || 'none'}`);
console.log(`[Simulator] Target machine: ${TARGET_MACHINE || 'both'}`);

// ===== HTTP helper =====
function postJson(path, body) {
  return new Promise((resolve, reject) => {
    const parsed = url.parse(`${SERVER_URL}${path}`);
    const data = JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'X-API-Key': API_KEY,
      },
    };

    const req = http.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(responseData) }); }
        catch { resolve({ status: res.statusCode, body: responseData }); }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ===== Noise function =====
function noise(base, amplitude) {
  return base + (Math.random() - 0.5) * 2 * amplitude;
}

// ===== Machine profiles =====
const MACHINE_PROFILES = {
  'FBD-5-01': {
    model: 'FBD-5',
    capacityKg: 5,
    products: ['Paracetamol 500', 'Ibuprofen 400'],
    normalLoad: 4.0,
    // Setpoints for the drying process
    inletTempSetpoint: 60,
    outletTempSetpoint: 40,
    productTempSetpoint: 40,
    airflowSetpoint: 220,
    diffPressureBase: 150,
    inletHumidityBase: 35,
    blowerSpeedSetpoint: 1200,
  },
  'FBD-10-01': {
    model: 'FBD-10',
    capacityKg: 10,
    products: ['Paracetamol 500', 'Ibuprofen 400'],
    normalLoad: 8.0,
    inletTempSetpoint: 60,
    outletTempSetpoint: 40,
    productTempSetpoint: 40,
    airflowSetpoint: 450,
    diffPressureBase: 180,
    inletHumidityBase: 35,
    blowerSpeedSetpoint: 1500,
  },
  'FBD-450-01': {
    model: 'FBD-450',
    capacityKg: 450,
    products: ['Paracetamol 500', 'Ibuprofen 400'],
    normalLoad: 350,
    inletTempSetpoint: 60,
    outletTempSetpoint: 40,
    productTempSetpoint: 40,
    airflowSetpoint: 1100,
    diffPressureBase: 300,
    inletHumidityBase: 35,
    blowerSpeedSetpoint: 2000,
  },
};

// ===== Machine simulation state =====
class MachineSimulator {
  constructor(tag, profile) {
    this.tag = tag;
    this.profile = profile;
    this.state = 'IDLE';
    this.phase = 'idle'; // idle | loading | ramping | holding | completing
    this.phaseElapsed = 0; // seconds in current phase
    this.batchProductIndex = 0;
    this.batchStartTime = null;
    this.idleWait = 5; // seconds to wait in IDLE before starting next batch
    this.injectFaultOnNextReading = false;
    this.faultType = null;

    // Current simulated values
    this.values = {
      inletTemp: 25,
      outletTemp: 25,
      productTemp: 25,
      airflow: 0,
      diffPressure: 0,
      inletHumidity: 55,
      blowerSpeed: 0,
    };
  }

  /** Move to the next product in rotation */
  nextProduct() {
    const p = this.profile.products[this.batchProductIndex % this.profile.products.length];
    this.batchProductIndex++;
    return p;
  }

  /** Advance simulation by one tick (1 second) */
  async tick() {
    this.phaseElapsed++;
    const p = this.profile;

    if (this.phase === 'idle') {
      // Gradually cool down to ambient
      this.values.inletTemp = Math.max(25, this.values.inletTemp - 0.5);
      this.values.outletTemp = Math.max(25, this.values.outletTemp - 0.3);
      this.values.productTemp = Math.max(25, this.values.productTemp - 0.3);
      this.values.airflow = 0;
      this.values.blowerSpeed = 0;
      this.values.diffPressure = 0;

      if (this.phaseElapsed >= this.idleWait) {
        await this.startBatch();
      }
      return null; // Don't send readings in IDLE
    }

    if (this.phase === 'loading') {
      // Brief loading phase - 3 seconds
      if (this.phaseElapsed >= 3) {
        this.phase = 'ramping';
        this.phaseElapsed = 0;
        // Send state = RUNNING
        await this.sendState('RUNNING');
      }
      return null;
    }

    if (this.phase === 'ramping') {
      // Ramp inlet temperature from ambient to setpoint over ~30 seconds
      const rampProgress = Math.min(1, this.phaseElapsed / 30);
      this.values.inletTemp = 25 + (p.inletTempSetpoint - 25) * rampProgress + noise(0, 0.5);
      this.values.airflow = p.airflowSetpoint * rampProgress + noise(0, 10);
      this.values.blowerSpeed = p.blowerSpeedSetpoint * rampProgress + noise(0, 20);
      this.values.outletTemp = 25 + (p.outletTempSetpoint - 25) * (rampProgress * 0.7) + noise(0, 0.5);
      this.values.productTemp = 25 + (p.productTempSetpoint - 25) * (rampProgress * 0.5) + noise(0, 0.3);
      this.values.diffPressure = p.diffPressureBase * rampProgress + noise(0, 5);
      this.values.inletHumidity = p.inletHumidityBase - rampProgress * 10 + noise(0, 1);

      if (rampProgress >= 1) {
        this.phase = 'holding';
        this.phaseElapsed = 0;
      }
    }

    if (this.phase === 'holding') {
      // Hold at setpoints with realistic noise for most of the batch duration
      const batchElapsed = Date.now() - this.batchStartTime;
      const batchProgress = batchElapsed / DURATION;

      // Differential pressure slowly increases as product dries
      const dpRise = 1 + batchProgress * 0.3;

      this.values.inletTemp = noise(p.inletTempSetpoint, 1.0);
      this.values.outletTemp = noise(p.outletTempSetpoint - batchProgress * 5, 0.8);
      this.values.productTemp = noise(p.productTempSetpoint - batchProgress * 2, 0.5);
      this.values.airflow = noise(p.airflowSetpoint, 15);
      this.values.blowerSpeed = noise(p.blowerSpeedSetpoint, 30);
      this.values.diffPressure = noise(p.diffPressureBase * dpRise, 8);
      this.values.inletHumidity = noise(p.inletHumidityBase - batchProgress * 5, 1.5);

      if (batchProgress >= 1) {
        this.phase = 'completing';
        this.phaseElapsed = 0;
      }
    }

    if (this.phase === 'completing') {
      // Brief completing phase
      if (this.phaseElapsed >= 2) {
        await this.sendState('DRYING_COMPLETE');
        this.phase = 'idle';
        this.phaseElapsed = 0;
        this.idleWait = 8; // 8 seconds idle between batches
        this.state = 'IDLE';
        return null;
      }
    }

    // Apply fault injection if scheduled
    const readingValues = { ...this.values };

    if (this.injectFaultOnNextReading) {
      this.injectFaultOnNextReading = false;
      if (this.faultType === 'spike') {
        // Temperature spike: 95°C (above 0–150 valid range? No. But above limit: 50–70 for inlet)
        // This is an OUT-OF-LIMIT value (valid sensor range is 0–150, so it passes validity)
        // It will trigger the LIMIT alarm path
        readingValues.inletTemp = 95;
        console.log(`[${this.tag}] FAULT: Temperature spike injected -> inletTemp=95`);
      } else if (this.faultType === 'sensor_null') {
        readingValues.inletTemp = null;
        console.log(`[${this.tag}] FAULT: Null sensor value injected -> inletTemp=null`);
      } else if (this.faultType === 'sensor_stuck') {
        // Will be simulated by keeping prevValue for >10 readings
        // Set a specific value for stuck detection
        readingValues.inletTemp = 60;
        readingValues._stuck = true;
        console.log(`[${this.tag}] FAULT: Stuck sensor simulated`);
      } else if (this.faultType === 'sensor_invalid') {
        // -999 — out of sensor range (0–150)
        readingValues.inletTemp = -999;
        console.log(`[${this.tag}] FAULT: Invalid sensor value injected -> inletTemp=-999`);
      }
    }

    return readingValues;
  }

  async startBatch() {
    const product = this.nextProduct();
    let loadKg = this.profile.normalLoad;

    // Fault: overload
    if (FAULT === 'overload' && this.tag === 'FBD-5-01') {
      loadKg = 6; // Exceeds 5kg capacity
      console.log(`[${this.tag}] FAULT: Overload batch - loadKg=${loadKg} (capacity: ${this.profile.capacityKg})`);
    }

    console.log(`[${this.tag}] Starting batch: ${product}, load=${loadKg}kg`);

    try {
      const result = await postJson('/api/ingest/batch-start', {
        machineTag: this.tag,
        ts: new Date().toISOString(),
        product,
        loadKg,
      });

      if (result.status === 422) {
        console.log(`[${this.tag}] Batch start REJECTED (overload): ${JSON.stringify(result.body)}`);
        // Still need to transition to some state
        this.phase = 'idle';
        this.phaseElapsed = 0;
        this.idleWait = 10;
        return;
      }

      this.batchStartTime = Date.now();
      this.phase = 'loading';
      this.phaseElapsed = 0;
      this.state = 'RUNNING';

      // Schedule fault injection if requested
      if (FAULT === 'spike' && (this.tag === 'FBD-5-01' || TARGET_MACHINE === this.tag)) {
        // Inject spike after 15 seconds of running
        setTimeout(() => {
          this.injectFaultOnNextReading = true;
          this.faultType = 'spike';
        }, 15000);

        // Inject again at 20s, 25s to trigger the consecutive alarm (N=3)
        setTimeout(() => {
          this.injectFaultOnNextReading = true;
          this.faultType = 'spike';
        }, 20000);
        setTimeout(() => {
          this.injectFaultOnNextReading = true;
          this.faultType = 'spike';
        }, 25000);
      }

      if (FAULT === 'sensor' && (this.tag === 'FBD-10-01' || TARGET_MACHINE === this.tag)) {
        setTimeout(() => {
          this.injectFaultOnNextReading = true;
          this.faultType = 'sensor_null';
        }, 10000);
        setTimeout(() => {
          this.injectFaultOnNextReading = true;
          this.faultType = 'sensor_invalid';
        }, 20000);
      }

    } catch (err) {
      console.error(`[${this.tag}] Error starting batch:`, err.message);
      this.phase = 'idle';
      this.phaseElapsed = 0;
      this.idleWait = 5;
    }
  }

  async sendState(state) {
    try {
      await postJson('/api/ingest/state', {
        machineTag: this.tag,
        ts: new Date().toISOString(),
        state,
      });
      console.log(`[${this.tag}] State -> ${state}`);
    } catch (err) {
      console.error(`[${this.tag}] Error sending state:`, err.message);
    }
  }

  async sendReading(values) {
    try {
      const result = await postJson('/api/ingest/reading', {
        machineTag: this.tag,
        ts: new Date().toISOString(),
        values,
      });
      if (result.status !== 200) {
        console.warn(`[${this.tag}] Reading response ${result.status}:`, result.body?.results?.[0]?.validationErrors);
      }
    } catch (err) {
      console.error(`[${this.tag}] Error sending reading:`, err.message);
    }
  }
}

// ===== Backfill simulation =====
async function simulateBackfill(machineTag) {
  console.log(`\n[Simulator] Starting backfill simulation for ${machineTag}...`);
  const twoMinsAgo = new Date(Date.now() - 120000);
  const readings = [];
  const p = MACHINE_PROFILES[machineTag];

  // Generate 120 readings (2 minutes at 1 Hz) with past timestamps
  for (let i = 0; i < 120; i++) {
    readings.push({
      machineTag,
      ts: new Date(twoMinsAgo.getTime() + i * 1000).toISOString(),
      values: {
        inletTemp: noise(p.inletTempSetpoint, 1),
        outletTemp: noise(p.outletTempSetpoint, 0.8),
        productTemp: noise(p.productTempSetpoint, 0.5),
        airflow: noise(p.airflowSetpoint, 10),
        diffPressure: noise(p.diffPressureBase, 5),
        inletHumidity: noise(p.inletHumidityBase, 1),
        blowerSpeed: noise(p.blowerSpeedSetpoint, 20),
      },
    });
  }

  // Sort by timestamp (should already be, but required for hash chain)
  readings.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  // Send as backfill batch
  const result = await postJson('/api/ingest/reading', { readings });
  console.log(`[Simulator] Backfill sent: ${readings.length} readings. Response: ${result.status}`);
}

// ===== Main loop =====
async function main() {
  // If backfill fault, do that and exit
  if (FAULT === 'backfill') {
    const targetTag = TARGET_MACHINE || 'FBD-5-01';
    await simulateBackfill(targetTag);
    console.log('[Simulator] Backfill complete. Exiting.');
    process.exit(0);
  }

  // Create machine simulators
  const machines = [];
  if (!TARGET_MACHINE || TARGET_MACHINE === 'FBD-5-01') {
    machines.push(new MachineSimulator('FBD-5-01', MACHINE_PROFILES['FBD-5-01']));
  }
  if (!TARGET_MACHINE || TARGET_MACHINE === 'FBD-10-01') {
    machines.push(new MachineSimulator('FBD-10-01', MACHINE_PROFILES['FBD-10-01']));
  }
  if (!TARGET_MACHINE || TARGET_MACHINE === 'FBD-450-01') {
    machines.push(new MachineSimulator('FBD-450-01', MACHINE_PROFILES['FBD-450-01']));
  }

  console.log(`[Simulator] Simulating ${machines.length} machine(s): ${machines.map(m => m.tag).join(', ')}`);
  console.log(`[Simulator] Reading interval: ${READING_INTERVAL_MS}ms`);
  console.log(`[Simulator] Press Ctrl+C to stop.\n`);

  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Start the main simulation loop
  const interval = setInterval(async () => {
    for (const machine of machines) {
      const values = await machine.tick();
      if (values) {
        // Log to console (brief)
        const { inletTemp, outletTemp, productTemp } = values;
        const display = inletTemp === null ? 'NULL' : `${Number(inletTemp || 0).toFixed(1)}°C`;
        process.stdout.write(`\r[${machine.tag}] Inlet:${display} Outlet:${Number(outletTemp || 0).toFixed(1)}°C Prod:${Number(productTemp || 0).toFixed(1)}°C`);
        await machine.sendReading(values);
      }
    }
  }, READING_INTERVAL_MS);

  process.on('SIGINT', () => {
    console.log('\n[Simulator] Stopping...');
    clearInterval(interval);
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Simulator] Fatal error:', err);
  process.exit(1);
});
