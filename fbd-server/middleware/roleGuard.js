/**
 * roleGuard.js — Role-based access control middleware factory.
 *
 * Usage:
 *   router.post('/review', auth, roleGuard(['QA', 'ADMIN']), handler)
 *   router.put('/limits/:id', auth, roleGuard(['ADMIN']), handler)
 */

/**
 * Create a middleware that allows only specified roles.
 * @param {string[]} allowedRoles - e.g. ['QA', 'ADMIN']
 * @returns {Function} Express middleware
 */
function roleGuard(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        detail: `Role '${req.user.role}' is not allowed. Required: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}

module.exports = roleGuard;
