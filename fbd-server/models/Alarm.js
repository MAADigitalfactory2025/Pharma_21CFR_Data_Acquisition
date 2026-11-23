/**
 * Alarm.js — Process limit violation events.
 *
 * An alarm is created when a valid reading is OUTSIDE the process limits
 * (limitMin/limitMax) for N consecutive readings (ALARM_CONSECUTIVE_THRESHOLD).
 *
 * Alarm lifecycle:
 *  OPEN   — raised when value stays out of limit for N readings
 *  CLOSED — automatically when a valid value returns to range (endedAt, peakValue set)
 *  REVIEWED — QA/ADMIN reviews with mandatory remarks
 *
 * Note: alarms CAN be updated (status, review fields) — unlike readings.
 * However, reviews are also logged in audit_logs.
 */
const mongoose = require('mongoose');

const alarmSchema = new mongoose.Schema(
  {
    machineId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Machine',
      required: true,
    },
    machineTag: { type: String, required: true },
    batchNo: { type: String, default: null },
    parameter: { type: String, required: true },
    displayName: { type: String },
    unit: { type: String },
    // The value that triggered the alarm (first out-of-limit reading)
    value: { type: Number, required: true },
    limitMin: { type: Number, required: true },
    limitMax: { type: Number, required: true },
    severity: {
      type: String,
      enum: ['CRITICAL', 'MAJOR'],
      required: true,
    },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },     // null = still active
    // Worst value seen during the alarm event
    peakValue: { type: Number },
    // How many consecutive out-of-limit readings triggered this
    consecutiveCount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['OPEN', 'CLOSED', 'REVIEWED'],
      default: 'OPEN',
    },
    reviewedBy: { type: String, default: null },
    reviewedAt: { type: Date, default: null },
    remarks: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'alarms',
  }
);

alarmSchema.index({ machineId: 1, status: 1 });
alarmSchema.index({ batchNo: 1 });
alarmSchema.index({ startedAt: -1 });

module.exports = mongoose.model('Alarm', alarmSchema);
