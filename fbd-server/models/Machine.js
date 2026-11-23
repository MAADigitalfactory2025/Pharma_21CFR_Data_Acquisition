/**
 * Machine.js — Mongoose model for pharmaceutical machines.
 * Generic design: machine type -> model -> unit.
 * Supports FBD-5, FBD-10 and any future model without code changes.
 */
const mongoose = require('mongoose');

const machineSchema = new mongoose.Schema(
  {
    tag: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      // e.g. "FBD-5-01", "FBD-10-01"
    },
    name: {
      type: String,
      required: true,
      trim: true,
      // e.g. "Fluid Bed Dryer 5 kg – Unit 01"
    },
    model: {
      type: String,
      required: true,
      enum: ['FBD-5', 'FBD-10', 'FBD-450'],
      // Can be extended later: 'RMG-150', 'TBM-16', etc.
    },
    capacityKg: {
      type: Number,
      required: true,
      // 5 for FBD-5, 10 for FBD-10
    },
    location: {
      type: String,
      default: 'Production Block A',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'MAINTENANCE', 'RETIRED'],
      default: 'ACTIVE',
    },
    calibrationDue: {
      type: Date,
    },
    lastCleanedAt: {
      type: Date,
    },
    // Current runtime state (not persisted to DB, but tracked in-memory via Socket.IO)
    // Stored here as last-known for page refresh
    lastKnownState: {
      type: String,
      enum: ['IDLE', 'RUNNING', 'DRYING_COMPLETE', 'ALARM'],
      default: 'IDLE',
    },
    currentBatchNo: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'machines',
  }
);

module.exports = mongoose.model('Machine', machineSchema);
