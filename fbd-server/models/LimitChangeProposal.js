const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  limitId: { type: mongoose.Schema.Types.ObjectId, ref: 'ParameterLimit', required: true },
  machineModel: String, product: String, parameter: String,
  currentMin: Number, currentMax: Number, proposedMin: Number, proposedMax: Number,
  reason: { type: String, required: true }, status: { type: String, enum: ['PENDING','APPROVED','REJECTED'], default: 'PENDING' },
  proposedBy: String, proposedByUsername: String, reviewedBy: String, reviewedByUsername: String, reviewedAt: Date, reviewReason: String,
}, { timestamps: true, collection: 'limit_change_proposals' });
module.exports = mongoose.model('LimitChangeProposal', schema);
