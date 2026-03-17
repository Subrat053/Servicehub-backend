const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  password: { type: String, minlength: 6 },
  role: { type: String, enum: ['provider', 'recruiter', 'admin'], required: true },
  avatar: { type: String, default: '' },
  profilePhoto: { type: String, default: '' },
  authProvider: { type: String, enum: ['email', 'google', 'whatsapp'], default: 'email' },
  googleId: { type: String, default: '' },
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  whatsappConsent: { type: Boolean, default: false },
  whatsappNumber: { type: String, default: '' },
  whatsappAlerts: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  isBlocked: { type: Boolean, default: false },
  termsAccepted: { type: Boolean, default: false },
  lastLogin: { type: Date },
  deviceInfo: { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  // Localization
  locale: {
    type: String,
    enum: ['en', 'hi', 'ar', 'ur', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'id', 'bn', 'ta', 'te', 'mr'],
    default: 'en',
  },
  preferredLanguage: {
    type: String,
    enum: ['en', 'hi', 'ar', 'ur', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'id', 'bn', 'ta', 'te', 'mr'],
    default: 'en',
  },
  country: { type: String, enum: ['IN', 'AE'], default: 'IN' },
  currency: { type: String, enum: ['INR', 'AED', 'USD'], default: 'INR' },
  // Subscription validity
  accountExpiresAt: { type: Date },
  renewalReminderSent: { type: Boolean, default: false },
  renewalReminder2Sent: { type: Boolean, default: false },
  // Badge
  subscriptionBadge: { type: String, default: '' },
}, { timestamps: true });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
