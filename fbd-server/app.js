/**
 * app.js — Express application setup with Socket.IO.
 *
 * Middleware stack:
 *   helmet (security headers) -> cors -> rate limiter -> json parser
 *   -> routes -> error handler
 *
 * Socket.IO is attached here and made available to routes via app.set('io', io).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const { Server: SocketIO } = require('socket.io');

const { generalLimiter, ingestLimiter } = require('./middleware/rateLimiter');
const { resolveSession } = require('./middleware/auth');

// Route modules
const ingestRouter = require('./routes/ingest');
const machinesRouter = require('./routes/machines');
const readingsRouter = require('./routes/readings');
const batchesRouter = require('./routes/batches');
const alarmsRouter = require('./routes/alarms');
const validationErrorsRouter = require('./routes/validationErrors');
const auditLogsRouter = require('./routes/auditLogs');
const limitsRouter = require('./routes/limits');
const reportsRouter = require('./routes/reports');

function createApp() {
  const app = express();
  const httpServer = http.createServer(app);

  // Attach Socket.IO
  const io = new SocketIO(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  // Make io available to route handlers
  app.set('io', io);

  // Socket.IO connection logging
  // Integrated mode: sockets must carry a valid login session and only receive events for their machines.
  if (process.env.GMP_AUTH_URL) {
    io.use(async (socket, next) => {
      try {
        const session = await resolveSession(socket.handshake.headers.cookie);
        if (!session) return next(new Error('Login required'));
        socket.data.allowedTags = session.allowedTags;
        next();
      } catch (e) { next(new Error('Login service unreachable')); }
    });
    io.emit = (event, payload) => {
      for (const [, s] of io.sockets.sockets) {
        const tags = s.data.allowedTags;
        if (tags && (!payload || !payload.machineTag || tags.has(payload.machineTag))) s.emit(event, payload);
      }
      return true;
    };
  }

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  // Security middleware
  app.use(helmet({
    crossOriginEmbedderPolicy: false, // Allow embedding for dev
  }));

  // CORS — allow the React dev server and any configured origin
  app.use(cors({
    origin: [
      process.env.CLIENT_URL || 'http://localhost:5173',
      'http://localhost:3000',
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Dev-Role'],
  }));

  // Body parsing
  app.use(express.json({ limit: '5mb' })); // 5mb for backfill batches

  // Health check (no auth, no rate limit)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString(), env: process.env.NODE_ENV });
  });

  // Rate limiting
  app.use('/api/ingest', ingestLimiter);
  app.use('/fbd-api', generalLimiter);

  // API Routes
  app.use('/api/ingest', ingestRouter);
  app.use('/fbd-api/machines', machinesRouter);
  app.use('/fbd-api/readings', readingsRouter);
  app.use('/fbd-api/batches', batchesRouter);
  app.use('/fbd-api/alarms', alarmsRouter);
  app.use('/fbd-api/validation-errors', validationErrorsRouter);
  app.use('/fbd-api/audit', auditLogsRouter);
  app.use('/fbd-api/limits', limitsRouter);
  app.use('/fbd-api/reports', reportsRouter);

  // 404 handler
  app.use((req, res) => {
    res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('[App Error]', err);
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });

  return { app, httpServer, io };
}

module.exports = { createApp };
