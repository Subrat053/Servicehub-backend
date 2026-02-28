const mongoose = require('mongoose');

const recruiterProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  companyName: { type: String, default: '' },
  companyType: { type: String, enum: ['company', 'shop', 'home', 'individual', 'other'], default: 'individual' },
  city: { type: String, default: '', trim: true },
  state: { type: String, default: '', trim: true },
  description: { type: String, default: '' },

  // Unlock pack
  currentPlan: { type: String, enum: ['free', 'starter', 'business', 'enterprise'], default: 'free' },
  planExpiresAt: { type: Date },
  unlocksRemaining: { type: Number, default: 0 },
  unlockPackSize: { type: Number, default: 0 },

  // Free limit tracking
  freeProfileViews: { type: Number, default: 0 },
  freeViewResetAt: { type: Date },

  // Stats
  totalJobsPosted: { type: Number, default: 0 },
  totalUnlocks: { type: Number, default: 0 },
  totalHires: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('RecruiterProfile', recruiterProfileSchema);
