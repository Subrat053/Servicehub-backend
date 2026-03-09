const mongoose = require('mongoose');

const visitHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  visitedUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  visitedProfile: { type: mongoose.Schema.Types.ObjectId, ref: 'ProviderProfile' },
  type: {
    type: String,
    enum: ['profile_view', 'search', 'contact_unlock', 'job_match'],
    required: true,
  },
  searchQuery: { type: String, default: '' },
  searchCity: { type: String, default: '' },
  searchSkill: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

visitHistorySchema.index({ user: 1, createdAt: -1 });
visitHistorySchema.index({ visitedUser: 1, createdAt: -1 });

module.exports = mongoose.model('VisitHistory', visitHistorySchema);
