const mongoose = require('mongoose');

const providerProfileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  skills: [{ type: String, trim: true }],
  experience: { type: String, default: '' },
  city: { type: String, required: true, trim: true },
  state: { type: String, default: '', trim: true },
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
  currentPlan: { type: String, enum: ['free', 'basic', 'pro', 'featured'], default: 'free' },
  planExpiresAt: { type: Date },
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
providerProfileSchema.index({ boostWeight: -1 });

module.exports = mongoose.model('ProviderProfile', providerProfileSchema);
