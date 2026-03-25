const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'JOB_POSTED',
  'NEW_LEAD',
  'CONTACT_UNLOCKED',
  'PROFILE_VIEWED',
  'PLAN_PURCHASED',
  'PLAN_EXPIRY_REMINDER',
  'ADMIN_ALERT',
];

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: NOTIFICATION_TYPES,
    required: true,
  },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
}, {
  versionKey: false,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Backward-compat alias for older code paths still reading `user`.
notificationSchema.virtual('user')
  .get(function getUserAlias() {
    return this.userId;
  })
  .set(function setUserAlias(value) {
    this.userId = value;
  });

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
