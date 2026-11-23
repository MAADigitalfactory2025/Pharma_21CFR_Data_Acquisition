/**
 * auditService.js — Central audit log writer.
 *
 * All audit events flow through this single function.
 * Never call AuditLog.save() directly — always use this service.
 *
 * The audit log is INSERT-ONLY. This service only creates documents.
 * Hash chain is maintained automatically.
 */
const AuditLog = require('../models/AuditLog');
const { computeHash, getLastHash } = require('./hashService');

// System user for automated events
const SYSTEM_USER = {
  userId: 'SYSTEM',
  userName: 'System',
  role: 'SYSTEM',
};

/**
 * Write an audit log entry.
 *
 * @param {Object} options
 * @param {string} options.action - e.g. 'BATCH_START', 'ALARM_RAISED'
 * @param {Object} options.user - { userId, userName, role } (name is accepted if userName is absent)
 * @param {string} [options.entity] - e.g. 'Batch', 'Alarm', 'ParameterLimit'
 * @param {string} [options.entityId] - ObjectId string or batchNo
 * @param {*} [options.oldValue] - for update events
 * @param {*} [options.newValue] - for update events
 * @param {string} [options.reason] - mandatory for limit changes and QA decisions
 * @param {string} [options.corrects] - reference to corrected record ID
 * @param {Date} [options.ts] - timestamp (defaults to now)
 * @returns {Promise<Object>} the created audit log document
 */
async function logEvent({
  action,
  user = SYSTEM_USER,
  entity,
  entityId,
  oldValue,
  newValue,
  reason,
  corrects,
  ts = new Date(),
}) {
  const payload = {
    ts,
    userId: user.userId,
    userName: user.userName || user.name,
    role: user.role,
    action,
    entity: entity || null,
    entityId: entityId ? String(entityId) : null,
    oldValue: oldValue !== undefined ? oldValue : null,
    newValue: newValue !== undefined ? newValue : null,
    reason: reason || null,
  };

  const prevHash = await getLastHash(AuditLog);
  const hash = computeHash(payload, prevHash);

  const log = new AuditLog({
    ...payload,
    corrects: corrects || null,
    prevHash,
    hash,
  });

  await log.save();
  return log;
}

/** Convenience: log a system event (no user context needed) */
async function logSystem(action, entity, entityId, details = {}) {
  return logEvent({ action, user: SYSTEM_USER, entity, entityId, ...details });
}

module.exports = { logEvent, logSystem, SYSTEM_USER };
