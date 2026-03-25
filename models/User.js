const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  password: { type: String, minlength: 6 },
  roles: [{ type: String, enum: ['provider', 'recruiter', 'admin'] }],
  activeRole: { type: String, enum: ['provider', 'recruiter', 'admin'] },
  // Legacy field kept temporarily for old records. Avoid using in new logic.
  role: { type: String, enum: ['provider', 'recruiter', 'admin'], required: false, select: false },
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
  country: { type: String, trim: true, uppercase: true, minlength: 2, maxlength: 2, default: 'US' },
  currency: { type: String, trim: true, uppercase: true, minlength: 3, maxlength: 3, default: 'USD' },
  // Subscription validity
  accountExpiresAt: { type: Date },
  renewalReminderSent: { type: Boolean, default: false },
  renewalReminder2Sent: { type: Boolean, default: false },
  // Badge
  subscriptionBadge: { type: String, default: '' },
}, { timestamps: true });

userSchema.pre('validate', function (next) {
  if (!Array.isArray(this.roles)) this.roles = [];

  if (!this.activeRole) {
    this.activeRole = this.roles[0] || this.role || null;
  }

  if (this.activeRole && !this.roles.includes(this.activeRole)) {
    this.roles.push(this.activeRole);
  }

  if (this.roles.length === 0 && this.role) {
    this.roles = [this.role];
    this.activeRole = this.role;
  }

  if (this.activeRole) {
    this.role = this.activeRole;
  }

  next();
});

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
