// Explicit machine-scoped operational permission enforcement.
const Machine = require('../models/Machine');
const prefix = 'MACHINE_MONITORING.';
function hasPermission(user, action) {
  return user?.role === 'ADMIN' || (user?.permissions || []).some(p =>
    p === action || p === prefix + action || p === 'FBD_OPERATIONS.' + action || p === 'MACHINE_MONITORING.' + action);
}
function requirePermission(action) {
  return (req, res, next) => hasPermission(req.user, action) ? next() :
    res.status(403).json({ error: 'Operational permission required: ' + action });
}
async function requireMachineAccess(req, res, next) {
  try {
    const machine = await Machine.findById(req.body.machineId);
    if (!machine) return res.status(404).json({ error: 'Machine not found' });
    if (req.allowedTags && !req.allowedTags.has(machine.tag))
      return res.status(403).json({ error: 'Machine not assigned' });
    req.targetMachine = machine;
    next();
  } catch { res.status(400).json({ error: 'Invalid machine ID' }); }
}
module.exports = { hasPermission, requirePermission, requireMachineAccess };
