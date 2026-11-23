/**
 * ParameterLimit.js — Versioned process limits per medicine and machine model.
 *
 * TWO DISTINCT CHECKS (never mixed):
 *  - validMin/validMax: sensor validity range (physical plausibility)
 *  - limitMin/limitMax: process operating limit (GMP requirement)
 *
 * Limits are stored as DATA (not hardcoded). A new medicine or model
 * is a new set of documents, not a change to the check logic.
 * The active row is unique on product + machineModel + parameter.
 *
 * Versioning: when a limit is updated, the old document is deactivated
 * (isActive=false) and a new document with version+1 is created.
 * No documents are ever deleted or overwritten.
 */
const mongoose = require('mongoose');

const parameterLimitSchema = new mongoose.Schema(
  {
    product: {
      type: String,
      required: true,
      trim: true,
      // e.g. "Paracetamol 500" — process band follows the medicine
    },
    machineModel: {
      type: String,
      required: true,
      enum: ['FBD-5', 'FBD-10', 'FBD-450'],
    },
    parameter: {
      type: String,
      required: true,
      // 'inletTemp' | 'outletTemp' | 'productTemp' | 'airflow'
      // | 'diffPressure' | 'inletHumidity' | 'blowerSpeed'
    },
    unit: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      required: true,
    },
    // Sensor validity range — physically possible readings
    validMin: { type: Number, required: true },
    validMax: { type: Number, required: true },
    // Process operating limits — GMP specification
    limitMin: { type: Number, required: true },
    limitMax: { type: Number, required: true },
    severity: {
      type: String,
      enum: ['CRITICAL', 'MAJOR'],
      required: true,
    },
    // Versioning for 21 CFR Part 11 / EU Annex 11 compliance
    version: {
      type: Number,
      required: true,
      default: 1,
    },
    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now,
    },
    effectiveTo: {
      type: Date,
      default: null, // null = currently active
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // Who changed this and why (audit fields)
    changedBy: {
      type: String,
      default: 'SYSTEM',
    },
    changeReason: {
      type: String,
      default: 'Initial setup',
    },
  },
  {
    timestamps: true,
    collection: 'parameter_limits',
  }
);

parameterLimitSchema.index(
  { product: 1, machineModel: 1, parameter: 1, isActive: 1 }
);

module.exports = mongoose.model('ParameterLimit', parameterLimitSchema);
