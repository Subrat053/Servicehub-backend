const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  plan: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  type: { type: String, enum: ['plan_purchase', 'unlock_pack', 'boost', 'renewal'], required: true },
  status: { type: String, enum: ['created', 'pending', 'completed', 'failed', 'refunded'], default: 'created' },
  paymentMethod: { type: String, default: '' },
  transactionId: { type: String, default: '' },

  // Stripe fields
  stripeSessionId: { type: String, default: '' },       // Checkout Session ID
  stripePaymentIntentId: { type: String, default: '' }, // PaymentIntent ID (from webhook)

  // Simulation mode
  isSimulated: { type: Boolean, default: false },

  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

paymentSchema.index({ user: 1 });
paymentSchema.index({ stripeSessionId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);
