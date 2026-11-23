/**
 * ValidationError.js — Rejected sensor readings. INSERT-ONLY.
 *
 * A reading that fails the VALIDITY CHECK is NEVER stored in readings.
 * Instead, a ValidationError document is created here.
 *
 * Failure reasons:
 *  NULL_VALUE      — sensor returned null, undefined, or empty
 *  NOT_NUMERIC     — value cannot be parsed as a number
 *  OUT_OF_SENSOR_RANGE — value is outside the physically possible range (validMin/validMax)
 *  SPIKE           — value changed by >50% in one step (configurable)
 *  STUCK           — same value for >10 consecutive readings
 *
 * Hash chain maintained identically to readings collection.
 */
const mongoose = require('mongoose');

const validationErrorSchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true, index: true },
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
    },
    machineTag: { type: String, required: true },
    batchNo: { type: String, default: null },
    parameter: { type: String, required: true },
    rejectedValue: { type: mongoose.Schema.Types.Mixed }, // Could be null, string, number
    reason: {
      type: String,
      enum: ['NULL_VALUE', 'NOT_NUMERIC', 'OUT_OF_SENSOR_RANGE', 'SPIKE', 'STUCK'],
      required: true,
    },
    // Tamper-evident hash chain
    prevHash: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
  },
  {
    timestamps: false,
    collection: 'validation_errors',
  }
);

validationErrorSchema.index({ machineId: 1, ts: -1 });
validationErrorSchema.index({ batchNo: 1 });

module.exports = mongoose.model('ValidationError', validationErrorSchema);
