/**
 * AuditLog.js — Tamper-evident GMP audit trail. INSERT-ONLY.
 *
 * Every significant system event is recorded here:
 *  - System start/stop
 *  - Batch auto-start and auto-end
 *  - Alarm raised and closed
 *  - Alarm reviewed (with remarks)
 *  - QA batch decision (electronic signature equivalent)
 *  - Limit changes (old and new values + reason)
 *  - User login/logout hooks
 *  - Report generated/exported
 *  - Integrity verification run
 *  - Validation errors (rejected readings)
 *
 * Corrections: never overwrite. Create a new record referencing the old one.
 *
 * Hash chain: same SHA-256 chain as readings.
 *
 * Database-level enforcement:
 *  Use a MongoDB user with insertOnly role for this collection.
 *  See README for MongoDB user setup commands.
 */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    ts: { type: Date, required: true, index: true, default: Date.now },
    userId: { type: String, required: true },
    userName: { type: String, required: true },
    role: { type: String, required: true },
    action: {
      type: String,
      required: true,
      // 'SYSTEM_START' | 'BATCH_START' | 'BATCH_END' | 'ALARM_RAISED' |
      // 'ALARM_CLOSED' | 'ALARM_REVIEWED' | 'QA_DECISION' | 'LIMIT_CHANGED' |
      // 'USER_LOGIN' | 'USER_LOGOUT' | 'REPORT_GENERATED' | 'REPORT_EXPORTED' |
      // 'INTEGRITY_VERIFIED' | 'VALIDATION_ERROR' | 'READING_INGESTED'
    },
    entity: { type: String }, // 'Batch' | 'Alarm' | 'ParameterLimit' | 'Reading' | 'ValidationError'
    entityId: { type: String }, // ObjectId or batchNo or other identifier
    // For limit changes, QA decisions, alarm reviews
    oldValue: { type: mongoose.Schema.Types.Mixed },
    newValue: { type: mongoose.Schema.Types.Mixed },
    reason: { type: String },
    // For corrections: reference to the original record
    corrects: { type: String, default: null },
    // Tamper-evident hash chain
    prevHash: { type: String, required: true },
    hash: { type: String, required: true, unique: true },
  },
  {
    timestamps: false,
    collection: 'audit_logs',
  }
);

auditLogSchema.index({ userId: 1, ts: -1 });
auditLogSchema.index({ entity: 1, entityId: 1 });
auditLogSchema.index({ action: 1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
