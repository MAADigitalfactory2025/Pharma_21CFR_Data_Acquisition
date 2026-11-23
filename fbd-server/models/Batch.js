/**
 * Batch.js — Batch lifecycle and auto-generated batch numbers.
 *
 * Batch number format: FBD{capacity}-YYMMDD-NNN
 *   e.g. FBD5-261104-001, FBD10-261104-002
 *
 * The batch number is:
 *  1. Auto-generated from the state machine (never typed by a human)
 *  2. Immutable after creation (locked)
 *  3. Unique (enforced by unique index)
 *
 * Batch status lifecycle:
 *  RUNNING -> DRYING_COMPLETE -> APPROVED | REJECTED
 *
 * Final status after QA decision:
 *  "PROCESS OK" if no alarms, "DEVIATION" if alarms exist
 *  Then QA sets "APPROVED" or "REJECTED"
 */
const mongoose = require('mongoose');

const batchSchema = new mongoose.Schema(
  {
    batchNo: {
      type: String,
      required: true,
      unique: true,
      immutable: true, // Cannot be changed after creation
    },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
    },
    machineTag: { type: String, required: true },
    machineModel: { type: String, required: true },
    product: {
      type: String,
      required: true,
      // Comes from machine/simulator, never typed by operator
    },
    loadKg: {
      type: Number,
      required: true,
      // Load weight from machine's load cell
    },
    capacityKg: {
      type: Number,
      required: true,
    },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    state: {
      type: String,
      enum: ['RUNNING', 'DRYING_COMPLETE'],
      default: 'RUNNING',
    },
    // Computed when batch ends
    summary: {
      durationMinutes: { type: Number },
      alarmCount: { type: Number, default: 0 },
      validationErrorCount: { type: Number, default: 0 },
      readingCount: { type: Number, default: 0 },
      parameterStats: {
        // { inletTemp: { min, max, avg }, outletTemp: {...}, ... }
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      // "PROCESS OK" or "DEVIATION"
      processResult: { type: String },
    },
    // QA review / electronic signature
    status: {
      type: String,
      enum: ['RUNNING', 'COMPLETE', 'APPROVED', 'REJECTED'],
      default: 'RUNNING',
    },
    qaDecision: {
      by: { type: String },
      byName: { type: String },
      at: { type: Date },
      decision: { type: String, enum: ['APPROVED', 'REJECTED'] },
      remarks: { type: String },
    },
  },
  {
    timestamps: true,
    collection: 'batches',
  }
);

batchSchema.index({ machineId: 1, startedAt: -1 });
batchSchema.index({ state: 1 });

module.exports = mongoose.model('Batch', batchSchema);
