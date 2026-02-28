const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true }, // phone or email
  otp: { type: String, required: true },
  type: { type: String, enum: ['phone', 'email'], required: true },
  isUsed: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Otp', otpSchema);
