const mongoose = require('mongoose');

const whatsappLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  phone: { type: String, required: true },
  templateName: { type: String, required: true },
  message: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'delivered', 'read', 'failed'], default: 'sent' },
  triggerEvent: { type: String, default: '' },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

module.exports = mongoose.model('WhatsappLog', whatsappLogSchema);
