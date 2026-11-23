/**
 * db.js — MongoDB connection with Mongoose
 * Connects once and reuses the connection across the app.
 */
const mongoose = require('mongoose');

let isConnected = false;

async function connectDB() {
  if (isConnected) return;

  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/fbd_system';

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log(`[DB] Connected to MongoDB at ${uri}`);
  } catch (err) {
    console.error('[DB] Connection error:', err.message);
    process.exit(1);
  }
}

module.exports = { connectDB };
