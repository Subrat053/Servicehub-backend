const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true },
  type: { type: String, enum: ['provider', 'recruiter'], required: true },
  price: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  priceAED: { type: Number, default: 0 },
  priceUSD: { type: Number, default: 0 },
  duration: { type: Number, default: 365 }, // in days (1 year default)
  features: [{ type: String }],
  maxSkills: { type: Number, default: 4 },
  unlockCredits: { type: Number, default: 0 },
  boostWeight: { type: Number, default: 0 },
  isRotationEligible: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  country: { type: String, default: 'IN' },
  sortOrder: { type: Number, default: 0 },

  // Subscription limits (configurable by admin)
  jobPostLimit: { type: Number, default: 2 },      // -1 = unlimited
  jobApplyLimit: { type: Number, default: 5 },      // -1 = unlimited
  jobNotification: { type: Boolean, default: false },
  badgeEnabled: { type: Boolean, default: false },
  priorityListing: { type: Boolean, default: false },
  status: { type: String, enum: ['active', 'inactive', 'archived'], default: 'active' },
}, { timestamps: true });

planSchema.index({ type: 1, slug: 1, duration: 1 }, { unique: true });

module.exports = mongoose.model('Plan', planSchema);
