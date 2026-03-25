const mongoose = require('mongoose');

const userSubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, enum: ['provider', 'recruiter'], required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
  isDefault: { type: Boolean, default: false },
  autoRenew: { type: Boolean, default: false },
}, { timestamps: true });

userSubscriptionSchema.index({ userId: 1, role: 1, status: 1 });
userSubscriptionSchema.index({ userId: 1, role: 1, createdAt: -1 });
userSubscriptionSchema.index({ endDate: 1, status: 1 });

module.exports = mongoose.model('UserSubscription', userSubscriptionSchema);
