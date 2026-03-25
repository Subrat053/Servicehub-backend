const mongoose = require('mongoose');

const approvalLogSchema = new mongoose.Schema({
  targetType: { type: String, enum: ['provider', 'recruiter'], required: true },
  targetProfileId: { type: mongoose.Schema.Types.ObjectId, required: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetName: { type: String, default: '' },
  action: { type: String, enum: ['approved', 'rejected'], required: true },
  note: { type: String, default: '' },
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actorName: { type: String, default: '' },
  actorRole: { type: String, enum: ['admin', 'manager'], required: true },
}, { timestamps: true });

approvalLogSchema.index({ targetType: 1, createdAt: -1 });
approvalLogSchema.index({ actorId: 1, createdAt: -1 });

module.exports = mongoose.model('ApprovalLog', approvalLogSchema);
