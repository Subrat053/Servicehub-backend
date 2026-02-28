/**
 * DEPRECATED – Razorpay has been replaced by Stripe.
 * This file is kept for migration reference only.
 * All payment logic now lives in utils/stripe.js
 */
module.exports = {};


/**
 * Get Razorpay configuration from AdminSettings DB
 * Keys stored: razorpay_key_id, razorpay_key_secret, razorpay_simulation_mode
 */
const getPaymentConfig = async () => {
  const settings = await AdminSetting.find({ category: 'payment' });
  const config = {};
  settings.forEach(s => {
    config[s.key] = s.value;
  });
  return {
    keyId: config.razorpay_key_id || process.env.RAZORPAY_KEY_ID || '',
    keySecret: config.razorpay_key_secret || process.env.RAZORPAY_KEY_SECRET || '',
    simulationMode: config.razorpay_simulation_mode === true || config.razorpay_simulation_mode === 'true',
    webhookSecret: config.razorpay_webhook_secret || process.env.RAZORPAY_WEBHOOK_SECRET || '',
  };
};

/**
 * Create a Razorpay instance with current credentials
 */
const getRazorpayInstance = async () => {
  const config = await getPaymentConfig();
  if (!config.keyId || !config.keySecret) {
    throw new Error('Razorpay credentials not configured. Set them in Admin → Settings → Payment.');
  }
  return new Razorpay({
    key_id: config.keyId,
    key_secret: config.keySecret,
  });
};

/**
 * Verify Razorpay payment signature (HMAC SHA256)
 */
const verifyPaymentSignature = async ({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) => {
  const config = await getPaymentConfig();
  const body = razorpay_order_id + '|' + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac('sha256', config.keySecret)
    .update(body)
    .digest('hex');
  return expectedSignature === razorpay_signature;
};

module.exports = { getPaymentConfig, getRazorpayInstance, verifyPaymentSignature };
