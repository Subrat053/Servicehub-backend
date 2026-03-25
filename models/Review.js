const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  // New normalized fields
  reviewerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  revieweeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },

  // Legacy compatibility fields (still used by existing pages/controllers)
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recruiter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' },
  jobPost: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPost' },
}, { timestamps: true });

reviewSchema.index({ provider: 1 });
reviewSchema.index({ revieweeId: 1, createdAt: -1 });
reviewSchema.index({ reviewerId: 1, revieweeId: 1, leadId: 1 }, { unique: true });

reviewSchema.pre('validate', function syncLegacyAndNormalized(next) {
  if (!this.reviewerId && this.recruiter) this.reviewerId = this.recruiter;
  if (!this.revieweeId && this.provider) this.revieweeId = this.provider;
  next();
});

module.exports = mongoose.model('Review', reviewSchema);
