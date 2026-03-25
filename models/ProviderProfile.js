const mongoose = require('mongoose');

const providerProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  skills: [{ type: String, trim: true }],
  tier: { type: String, enum: ['unskilled', 'semi-skilled', 'skilled'], default: 'unskilled' },
  experience: { type: String, default: '' },
  city: { type: String, default: '', trim: true },
  state: { type: String, default: '', trim: true },
  nearestLocation: { type: String, default: '', trim: true },
  latitude: { type: Number, default: null },
  longitude: { type: Number, default: null },
  locationUpdatedAt: { type: Date, default: null },
  languages: [{ type: String }],
  description: { type: String, default: '' },
  portfolioLinks: [{ type: String }],
  documents: [{ type: String }],
  photo: { type: String, default: '' },
  profilePhoto: { type: String, default: '' },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  totalReviews: { type: Number, default: 0 },
  profileCompletion: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false },
  isApproved: { type: Boolean, default: false },

  // Plan & boost
  currentPlan: { type: String, enum: ['free', 'starter', 'business', 'enterprise', 'basic', 'pro', 'featured'], default: 'free' },
  planExpiresAt: { type: Date },
  subscriptionPlan: { type: String, enum: ['free', 'enterprise'], default: 'free' },
  subscriptionStartDate: { type: Date, default: null },
  subscriptionEndDate: { type: Date, default: null },
  isActiveSubscription: { type: Boolean, default: false },
  isTopCity: { type: Boolean, default: false },
  boostWeight: { type: Number, default: 0 },

  // Rotation pool
  inRotationPool: { type: Boolean, default: false },
  lastShownAt: { type: Date },

  // Validity
  profileExpiresAt: { type: Date },
  renewalReminderSent: { type: Boolean, default: false },

  // WhatsApp
  whatsappAlerts: { type: Boolean, default: true },

  // Stats
  profileViews: { type: Number, default: 0 },
  leadsReceived: { type: Number, default: 0 },
  contactsUnlocked: { type: Number, default: 0 },
}, { timestamps: true });

providerProfileSchema.index({ skills: 1, city: 1 });
providerProfileSchema.index({ city: 1 });
providerProfileSchema.index({ tier: 1 });
providerProfileSchema.index({ boostWeight: -1 });
providerProfileSchema.index({ latitude: 1, longitude: 1 });

module.exports = mongoose.model('ProviderProfile', providerProfileSchema);
