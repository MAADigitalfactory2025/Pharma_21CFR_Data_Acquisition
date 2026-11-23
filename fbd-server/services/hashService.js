/**
 * hashService.js — SHA-256 hash chain for tamper-evident records.
 *
 * Algorithm:
 *   hash = SHA-256( JSON.stringify(payload) + prevHash )
 *
 * The prevHash of the FIRST record in a collection is "GENESIS".
 *
 * Usage:
 *   const { computeHash, getLastHash, verifyChain } = require('./hashService');
 *
 *   const prevHash = await getLastHash(Model);
 *   const hash = computeHash(payload, prevHash);
 *   await new Model({ ...payload, prevHash, hash }).save();
 */
const crypto = require('crypto');

/**
 * Compute SHA-256 hash of a payload + prevHash.
 * @param {Object} payload - The document fields (excluding prevHash and hash)
 * @param {string} prevHash - The hash of the previous document
 * @returns {string} hex SHA-256 hash
 */
function computeHash(payload, prevHash) {
  const data = JSON.stringify(payload) + prevHash;
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Get the hash of the most recently inserted document in a collection.
 * @param {mongoose.Model} Model - The Mongoose model
 * @returns {Promise<string>} The last hash, or 'GENESIS' if no documents exist
 */
async function getLastHash(Model) {
  const last = await Model.findOne({}, { hash: 1 }).sort({ _id: -1 }).lean();
  return last ? last.hash : 'GENESIS';
}

/**
 * Verify the entire hash chain of a collection.
 * Re-computes each hash and checks it matches the stored hash.
 *
 * @param {mongoose.Model} Model - The Mongoose model
 * @param {Array<string>} payloadFields - Fields to include in the hash payload
 * @returns {Promise<{ intact: boolean, brokenAt: Object|null, totalChecked: number }>}
 */
async function verifyChain(Model, payloadFields) {
  const docs = await Model.find({}).sort({ _id: 1 }).lean();

  if (docs.length === 0) {
    return { intact: true, brokenAt: null, totalChecked: 0 };
  }

  let expectedPrevHash = 'GENESIS';

  for (const doc of docs) {
    // Build payload from specified fields only
    const payload = {};
    for (const field of payloadFields) {
      // Handle nested fields like 'values.inletTemp' using dot notation
      const parts = field.split('.');
      if (parts.length === 1) {
        payload[field] = doc[field];
      } else {
        // For nested: build the same structure
        let obj = payload;
        let src = doc;
        for (let i = 0; i < parts.length - 1; i++) {
          obj[parts[i]] = obj[parts[i]] || {};
          obj = obj[parts[i]];
          src = src ? src[parts[i]] : undefined;
        }
        obj[parts[parts.length - 1]] = src ? src[parts[parts.length - 1]] : undefined;
      }
    }

    const expectedHash = computeHash(payload, expectedPrevHash);

    if (expectedHash !== doc.hash) {
      return {
        intact: false,
        brokenAt: {
          _id: doc._id,
          ts: doc.ts,
          storedHash: doc.hash,
          expectedHash,
          prevHash: doc.prevHash,
          expectedPrevHash,
        },
        totalChecked: docs.indexOf(doc) + 1,
      };
    }

    expectedPrevHash = doc.hash;
  }

  return { intact: true, brokenAt: null, totalChecked: docs.length };
}

// Field lists for each collection's hash payload
const HASH_FIELDS = {
  Reading: ['ts', 'machineId', 'machineTag', 'batchNo', 'values'],
  ValidationError: ['ts', 'machineId', 'machineTag', 'batchNo', 'parameter', 'rejectedValue', 'reason'],
  AuditLog: ['ts', 'userId', 'userName', 'role', 'action', 'entity', 'entityId', 'oldValue', 'newValue', 'reason'],
};

module.exports = { computeHash, getLastHash, verifyChain, HASH_FIELDS };
