/**
 * auth.js — Authentication for the FBD data service.
 *
 * GMP_AUTH_URL set (integrated mode): the browser's login session cookie is forwarded to the
 * Spring Boot login service (GET /api/me, GET /api/machines/{id}/data-access). The FBD service
 * trusts only those answers: ITADMIN -> role ADMIN, every other user -> OPERATOR, and the
 * machines a user may see are exactly those the login service authorises for VIEW_MACHINE_DATA.
 *
 * GMP_AUTH_URL unset + DEV_AUTH=true: standalone dev mode (X-Dev-Role header), all machines visible.
 * Otherwise: JWT bearer token (original behaviour).
 */
const jwt = require('jsonwebtoken');

// Login-service machine IDs -> FBD machine tags.
const MACHINE_TAGS = { M001: 'FBD-5-01', M002: 'FBD-10-01', M003: 'FBD-450-01' };

const DEV_USERS = {
  OPERATOR: { userId: 'dev-op-1', name: 'Dev Operator', userName: 'Dev Operator', role: 'OPERATOR' },
  QA: { userId: 'dev-qa-1', name: 'QA Demo', userName: 'QA Demo', role: 'QA' },
  ADMIN: { userId: 'dev-admin-1', name: 'Dev Admin', userName: 'Dev Admin', role: 'ADMIN' },
};

const authUrl = () => process.env.GMP_AUTH_URL;
const CACHE_MS = 5000;
const cache = new Map(); // cookie -> { at, value }

async function gmpGet(path, cookie) {
  const r = await fetch(`${authUrl()}${path}`, { headers: { cookie } });
  return { status: r.status, body: r.ok ? (await r.json()).data : null };
}

/** Resolve a login-service session to { user, allowedTags } or null (not logged in / no data permission). */
async function resolveSession(cookie) {
  if (!cookie) return null;
  const hit = cache.get(cookie);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value = null;
  const me = await gmpGet('/api/me', cookie);
  if (me.body && (me.body.admin === true || (typeof me.body.id === 'string' && me.body.id.length > 0))) {
    const allowed = new Set();
    for (const [id, tag] of Object.entries(MACHINE_TAGS)) {
      if (me.body.admin === true || (await gmpGet(`/api/machines/${id}/data-access`, cookie)).status === 200) allowed.add(tag);
    }
    const name = me.body.username;
    value = {
      user: { userId: me.body.id, name, userName: name, role: me.body.admin ? 'ADMIN' : 'OPERATOR', permissions: Array.isArray(me.body.effectivePermissions) ? me.body.effectivePermissions : (Array.isArray(me.body.permissions) ? me.body.permissions : []) },
      allowedTags: allowed,
    };
  }
  cache.set(cookie, { at: Date.now(), value });
  return value;
}

async function authMiddleware(req, res, next) {
  if (authUrl()) {
    try {
      const session = await resolveSession(req.headers.cookie);
      if (!session) return res.status(401).json({ error: 'Login required, or no permission to view machine data' });
      req.user = session.user;
      req.allowedTags = session.allowedTags;
      return next();
    } catch (err) {
      return res.status(503).json({ error: 'Login service unreachable', detail: err.message });
    }
  }

  if (process.env.DEV_AUTH === 'true') {
    const devRole = (req.headers['x-dev-role'] || 'QA').toUpperCase();
    req.user = DEV_USERS[devRole] || DEV_USERS['QA'];
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET || 'changeme');
    const name = decoded.name || decoded.userName;
    req.user = { userId: decoded.userId, name, userName: name, role: decoded.role };
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token', detail: err.message });
  }
}

/** Mongo filter fragment limiting a query to the caller's machines ({} when unrestricted). */
function tagScope(req, field = 'machineTag') {
  return req.allowedTags ? { [field]: { $in: [...req.allowedTags] } } : {};
}

const forbidden = (res) => res.status(403).json({ error: 'No access to this machine' });

/** For routes with :batchNo - the batch's machine must be one the caller may see. */
async function batchScope(req, res, next) {
  if (!req.allowedTags) return next();
  const batch = await require('../models/Batch').findOne({ batchNo: req.params.batchNo }).select('machineTag').lean();
  if (batch && !req.allowedTags.has(batch.machineTag)) return forbidden(res);
  next();
}

/** For routes taking ?machineId= - that machine must be one the caller may see. */
async function machineScope(req, res, next) {
  if (!req.allowedTags || !req.query.machineId) return next();
  const m = await require('../models/Machine').findById(req.query.machineId).select('tag').lean();
  if (m && !req.allowedTags.has(m.tag)) return forbidden(res);
  next();
}

/** FBD audit trail needs the login service's VIEW_AUDIT_LOGS permission (ITADMIN has it). */
function auditAccess(req, res, next) {
  // The existing FBD audit collection does not store a reliable machine identifier.
  // Never expose mixed-machine audit entries to ordinary users.
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Machine-scoped audit view is not yet available' });
  next();
}

module.exports = authMiddleware;
module.exports.batchScope = batchScope;
module.exports.machineScope = machineScope;
module.exports.auditAccess = auditAccess;
module.exports.tagScope = tagScope;
module.exports.resolveSession = resolveSession;
module.exports.MACHINE_TAGS = MACHINE_TAGS;
