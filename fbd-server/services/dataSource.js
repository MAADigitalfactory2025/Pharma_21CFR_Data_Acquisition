/**
 * dataSource.js — ABSTRACTION LAYER for machine data input.
 *
 * This file is the ONLY place that knows HOW data arrives from the machine.
 * All other server code calls this module's interface.
 *
 * CURRENT IMPLEMENTATION: HTTP POST endpoints (from simulator or real PLC)
 * The simulator calls POST /api/ingest/reading, /api/ingest/state, /api/ingest/batch-start
 *
 * TO REPLACE WITH MQTT:
 *   1. Install: npm install mqtt
 *   2. Comment out the HTTP section below
 *   3. Uncomment and fill the MQTT section
 *   4. The rest of the server code is unchanged
 *
 * TO REPLACE WITH OPC UA:
 *   1. Install: npm install node-opcua
 *   2. Comment out the HTTP section below
 *   3. Add an OPC UA subscription that calls onReading(), onStateChange(), onBatchStart()
 *
 * TO REPLACE WITH MODBUS TCP:
 *   1. Install: npm install jsmodbus
 *   2. Add polling loop that reads Modbus registers and calls onReading()
 *
 * Interface (all callers use these):
 *   dataSource.onReading(handler)      — called with { machineTag, ts, values }
 *   dataSource.onStateChange(handler)  — called with { machineTag, ts, state }
 *   dataSource.onBatchStart(handler)   — called with { machineTag, ts, product, loadKg }
 */

const EventEmitter = require('events');

class DataSource extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(20);
  }

  /**
   * Register handler for new readings.
   * @param {Function} handler - async (payload) => void
   */
  onReading(handler) {
    this.on('reading', handler);
  }

  /**
   * Register handler for machine state changes.
   * @param {Function} handler - async (payload) => void
   */
  onStateChange(handler) {
    this.on('stateChange', handler);
  }

  /**
   * Register handler for batch start events.
   * @param {Function} handler - async (payload) => void
   */
  onBatchStart(handler) {
    this.on('batchStart', handler);
  }

  /**
   * Emit a reading event (called by HTTP ingest route).
   * In MQTT mode, this would be called from the MQTT message handler.
   */
  emitReading(payload) {
    this.emit('reading', payload);
  }

  emitStateChange(payload) {
    this.emit('stateChange', payload);
  }

  emitBatchStart(payload) {
    this.emit('batchStart', payload);
  }

  /*
  ============================================================
  MQTT IMPLEMENTATION (uncomment to replace HTTP):
  ============================================================
  async connectMQTT() {
    const mqtt = require('mqtt');
    const client = mqtt.connect(process.env.MQTT_BROKER_URL);

    client.on('connect', () => {
      console.log('[DataSource] MQTT connected');
      client.subscribe('fbd/+/reading');
      client.subscribe('fbd/+/state');
      client.subscribe('fbd/+/batch-start');
    });

    client.on('message', (topic, message) => {
      const payload = JSON.parse(message.toString());
      if (topic.includes('/reading'))     this.emitReading(payload);
      if (topic.includes('/state'))       this.emitStateChange(payload);
      if (topic.includes('/batch-start')) this.emitBatchStart(payload);
    });
  }
  ============================================================
  */
}

// Singleton instance shared across the app
const dataSource = new DataSource();
module.exports = dataSource;
