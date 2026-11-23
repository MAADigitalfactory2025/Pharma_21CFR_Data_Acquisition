/**
 * rateLimiter.js — Express rate limiting configuration.
 * Production: 100 requests per minute per IP on /api.
 * Development: a much higher cap so page loads and refreshes are not blocked.
 * Ingestion endpoints get a higher limit (600/min = 10/sec for 2 machines).
 */
const rateLimit = require('express-rate-limit');

const isProduction = process.env.NODE_ENV === 'production';

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isProduction ? 100 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600, // ~10/second for 2 machines running at 1 Hz
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Ingestion rate limit exceeded' },
});

module.exports = { generalLimiter, ingestLimiter };
