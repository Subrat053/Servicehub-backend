const mongoose = require('mongoose');

const applicationSchema = new mongoose.Schema({
  jobPost: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPost', required: true },
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'reviewed', 'contacted', 'shortlisted', 'rejected', 'hired'], default: 'pending' },
  coverLetter: { type: String, default: '' },
  appliedAt: { type: Date, default: Date.now },
}, { timestamps: true });

applicationSchema.index({ jobPost: 1, provider: 1 }, { unique: true });
applicationSchema.index({ provider: 1, createdAt: -1 });
applicationSchema.index({ jobPost: 1, status: 1 });

module.exports = mongoose.model('Application', applicationSchema);
