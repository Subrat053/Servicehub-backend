const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  provider: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recruiter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jobPost: { type: mongoose.Schema.Types.ObjectId, ref: 'JobPost' },
  type: { type: String, enum: ['profile_view', 'contact_unlock', 'job_match', 'direct_contact'], required: true },
  status: { type: String, enum: ['new', 'viewed', 'contacted', 'hired', 'rejected'], default: 'new' },
  message: { type: String, default: '' },
  isUnlocked: { type: Boolean, default: false },
  unlockPaymentId: { type: String, default: '' },
  notifiedViaWhatsapp: { type: Boolean, default: false },
}, { timestamps: true });

leadSchema.index({ provider: 1, status: 1 });
leadSchema.index({ recruiter: 1 });

module.exports = mongoose.model('Lead', leadSchema);
