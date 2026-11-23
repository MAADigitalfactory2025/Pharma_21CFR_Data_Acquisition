/**
 * server.js — Entry point. Connects to DB then starts the HTTP server.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { connectDB } = require('./config/db');
const { createApp } = require('./app');
const { logSystem } = require('./services/auditService');
const { ensureProductLimits } = require('./services/limitCatalog');
const { invalidateLimitsCache } = require('./services/validationService');

const PORT = process.env.PORT || 3001;

async function main() {
  await connectDB();

  try {
    const limitResult = await ensureProductLimits();
    invalidateLimitsCache();
    if (limitResult.created || limitResult.retired) {
      console.log(`[Server] Medicine limits: created ${limitResult.created}, retired legacy ${limitResult.retired}`);
    }
  } catch (err) {
    console.warn('[Server] Could not ensure medicine-specific limits:', err.message);
  }

  const { httpServer } = createApp();

  httpServer.listen(PORT, async () => {
    console.log(`\n[Server] FBD Data Acquisition System running on port ${PORT}`);
    console.log(`[Server] DEV_AUTH mode: ${process.env.DEV_AUTH === 'true' ? 'ON (no JWT required)' : 'OFF (JWT required)'}`);
    console.log(`[Server] API Key: ${process.env.API_KEY ? '****' + process.env.API_KEY.slice(-4) : 'NOT SET'}`);
    console.log(`[Server] Health: http://localhost:${PORT}/health\n`);

    // Log system start event
    try {
      await logSystem('SYSTEM_START', null, null, {
        newValue: { port: PORT, nodeEnv: process.env.NODE_ENV },
      });
    } catch (e) {
      console.warn('[Server] Could not write system-start audit log (DB may still be initializing)');
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[Server] SIGTERM received, shutting down gracefully...');
    httpServer.close(() => process.exit(0));
  });
  process.on('SIGINT', () => {
    console.log('[Server] SIGINT received, shutting down gracefully...');
    httpServer.close(() => process.exit(0));
  });
}

main().catch(err => {
  console.error('[Server] Fatal startup error:', err);
  process.exit(1);
});
