const mongoose = require('mongoose');

const recruiterProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  companyName: { type: String, default: '' },
  companyType: { type: String, enum: ['company', 'shop', 'home', 'individual', 'other'], default: 'individual' },
  city: { type: String, default: '', trim: true },
  state: { type: String, default: '', trim: true },
  nearestLocation: { type: String, default: '', trim: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  locationUpdatedAt: { type: Date, default: null },
  description: { type: String, default: '' },
  skillsNeeded: [{ type: String, trim: true }],   // skills the recruiter wants to hire for

  // Unlock pack
  currentPlan: { type: String, enum: ['free', 'starter', 'business', 'enterprise'], default: 'free' },
  planExpiresAt: { type: Date },
  unlocksRemaining: { type: Number, default: 0 },
  unlockPackSize: { type: Number, default: 0 },

  // Free limit tracking
  freeProfileViews: { type: Number, default: 0 },
  freeViewResetAt: { type: Date },
  freeUnlockResetAt: { type: Date },

  profilePhoto: { type: String, default: '' },

  // Reputation
  avgRating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },

  // Approval
  isApproved: { type: Boolean, default: false },
  isVerified: { type: Boolean, default: false },
  approvalAction: { type: String, enum: ['approved', 'rejected', 'pending'], default: 'pending' },
  approvalNote: { type: String, default: '' },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedByRole: { type: String, enum: ['admin', 'manager'], default: null },
  approvedAt: { type: Date, default: null },

  // WhatsApp
  whatsappAlerts: { type: Boolean, default: true },

  // Validity
  profileExpiresAt: { type: Date },
  renewalReminderSent: { type: Boolean, default: false },

  // Stats
  totalJobsPosted: { type: Number, default: 0 },
  totalUnlocks: { type: Number, default: 0 },
  totalHires: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('RecruiterProfile', recruiterProfileSchema);
