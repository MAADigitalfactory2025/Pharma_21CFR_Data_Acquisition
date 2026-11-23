/**
 * Reading.js — Machine sensor readings. INSERT-ONLY.
 *
 * Uses MongoDB time-series collection if supported (MongoDB 5.0+).
 * Falls back to a normal collection with compound index on (machineId, ts).
 *
 * Hash chain: each document contains a hash of its own content plus
 * the hash of the previous document, creating a tamper-evident chain.
 * hash = SHA-256(JSON(record fields) + prevHash)
 *
 * DO NOT add update or delete routes for this model.
 */
const mongoose = require('mongoose');

const readingSchema = new mongoose.Schema(
  {
    ts: {
      type: Date,
      required: true,
      index: true,
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
    },
    machineTag: {
      type: String,
      required: true,
    },
    batchNo: {
      type: String,
      default: null,
    },
    // All 7 parameters in a single embedded document
    values: {
      inletTemp: { type: Number },       // °C
      outletTemp: { type: Number },      // °C
      productTemp: { type: Number },     // °C
      airflow: { type: Number },         // m³/h
      diffPressure: { type: Number },    // Pa
      inletHumidity: { type: Number },   // %RH
      blowerSpeed: { type: Number },     // RPM
    },
    // Calculated at acquisition time; immutable snapshot of statistical and absolute bands.
    limitSnapshots: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Tamper-evident hash chain
    prevHash: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
  },
  {
    // Use a plain collection; time-series setup is done in db.js
    timestamps: false,
    collection: 'readings',
  }
);

// Compound index for efficient querying by machine + time window
readingSchema.index({ machineId: 1, ts: -1 });
readingSchema.index({ batchNo: 1 });

module.exports = mongoose.model('Reading', readingSchema);
