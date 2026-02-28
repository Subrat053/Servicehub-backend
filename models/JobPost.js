const mongoose = require('mongoose');

const jobPostSchema = new mongoose.Schema({
  recruiter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  skill: { type: String, required: true, trim: true },
  city: { type: String, required: true, trim: true },
  budgetMin: { type: Number, default: 0 },
  budgetMax: { type: Number, default: 0 },
  budgetType: { type: String, enum: ['fixed', 'hourly', 'monthly', 'negotiable'], default: 'negotiable' },
  description: { type: String, required: true },
  requirements: [{ type: String }],
  status: { type: String, enum: ['active', 'closed', 'expired', 'draft'], default: 'active' },
  applicants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  matchedProviders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ProviderProfile' }],
  expiresAt: { type: Date },
}, { timestamps: true });

jobPostSchema.index({ skill: 1, city: 1 });
jobPostSchema.index({ recruiter: 1 });

module.exports = mongoose.model('JobPost', jobPostSchema);
