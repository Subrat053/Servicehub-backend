const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recruiter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' },
  jobPost: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPost' },
}, { timestamps: true });

reviewSchema.index({ provider: 1 });

module.exports = mongoose.model('Review', reviewSchema);
