const Stripe = require('stripe');
const AdminSetting = require('../models/AdminSetting');

/**
 * Get Stripe configuration from AdminSettings DB
 * Keys stored: stripe_publishable_key, stripe_secret_key,
 *              stripe_webhook_secret, stripe_simulation_mode
 */
const getPaymentConfig = async () => {
  const settings = await AdminSetting.find({ category: 'payment' });
  const config = {};
  settings.forEach(s => {
    config[s.key] = s.value;
  });
  return {
    publishableKey: config.stripe_publishable_key || process.env.STRIPE_PUBLISHABLE_KEY || '',
    secretKey: config.stripe_secret_key || process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: config.stripe_webhook_secret || process.env.STRIPE_WEBHOOK_SECRET || '',
    simulationMode:
      config.stripe_simulation_mode === true ||
      config.stripe_simulation_mode === 'true',
  };
};

/**
 * Create a Stripe instance with the current secret key
 * Throws if credentials are not configured.
 */
const getStripeInstance = async () => {
  const config = await getPaymentConfig();
  if (!config.secretKey) {
    throw new Error(
      'Stripe credentials not configured. Set them in Admin → Payments.'
    );
  }
  return Stripe(config.secretKey);
};

module.exports = { getPaymentConfig, getStripeInstance };
