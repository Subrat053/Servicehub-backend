const mongoose = require('mongoose');

const adminSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  description: { type: String, default: '' },
  category: { type: String, enum: ['pricing', 'limits', 'rotation', 'whatsapp', 'general', 'terms', 'privacy', 'faq', 'payment', 'currency', 'cloudinary', 'notification'], default: 'general' },
}, { timestamps: true });

module.exports = mongoose.model('AdminSetting', adminSettingSchema);
