const Payment = require('../models/Payment');
const Plan = require('../models/Plan');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const RotationPool = require('../models/RotationPool');
const { getStripeInstance, getPaymentConfig } = require('../utils/stripe');

// Helper: update rotation pool
async function updateRotationPool(skill, city, profileId) {
  const poolSize = parseInt(process.env.ROTATION_POOL_SIZE || 5);
  let pool = await RotationPool.findOne({ skill: skill.toLowerCase(), city: city.toLowerCase() });
  if (!pool) {
    pool = await RotationPool.create({
      skill: skill.toLowerCase(),
      city: city.toLowerCase(),
      providers: [{ provider: profileId }],
      maxPoolSize: poolSize,
    });
  } else {
    const exists = pool.providers.some(p => p.provider.toString() === profileId.toString());
    if (!exists && pool.providers.length < pool.maxPoolSize) {
      pool.providers.push({ provider: profileId });
      await pool.save();
    }
  }
}

// Helper: activate plan on a provider profile
async function activateProviderPlan(userId, plan) {
  const profile = await ProviderProfile.findOne({ user: userId });
  if (!profile) return;
  profile.currentPlan = plan.slug;
  profile.planExpiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
  profile.boostWeight = plan.boostWeight || 0;
  profile.isTopCity = plan.isRotationEligible || false;
  profile.inRotationPool = plan.isRotationEligible || false;
  await profile.save();

  if (plan.isRotationEligible && profile.skills.length > 0 && profile.city) {
    for (const skill of profile.skills) {
      await updateRotationPool(skill, profile.city, profile._id);
    }
  }
  return profile;
}

// Helper: activate plan on a recruiter profile
async function activateRecruiterPlan(userId, plan) {
  const profile = await RecruiterProfile.findOne({ user: userId });
  if (!profile) return;
  profile.currentPlan = plan.slug;
  profile.planExpiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
  profile.unlocksRemaining += plan.unlockCredits || 0;
  profile.unlockPackSize = plan.unlockCredits || 0;
  await profile.save();
  return profile;
}

/**
 * @desc    Returns the Stripe publishable key + simulation mode flag
 * @route   GET /api/payments/config
 * @access  Private
 */
const getPaymentPublicConfig = async (req, res) => {
  try {
    const config = await getPaymentConfig();
    res.json({
      publishableKey: config.publishableKey,
      simulationMode: config.simulationMode,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Create a Stripe Checkout Session (or simulate a payment)
 * @route   POST /api/payments/create-order
 * @access  Private
 * @body    { planId, successUrl, cancelUrl }
 */
const createOrder = async (req, res) => {
  try {
    const { planId, successUrl, cancelUrl } = req.body;
    if (!planId) return res.status(400).json({ message: 'planId is required' });

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    if (!plan.isActive) return res.status(400).json({ message: 'Plan is not active' });

    if (req.user.role !== plan.type && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Plan not available for your role' });
    }

    const config = await getPaymentConfig();

    // ---------------------------------------- SIMULATION MODE
    if (config.simulationMode) {
      const simulatedTxnId = `SIM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const payment = await Payment.create({
        user: req.user._id,
        plan: plan._id,
        amount: plan.price,
        currency: (plan.currency || 'INR').toUpperCase(),
        type: 'plan_purchase',
        status: 'completed',
        transactionId: simulatedTxnId,
        stripeSessionId: `sim_session_${Date.now()}`,
        stripePaymentIntentId: simulatedTxnId,
        isSimulated: true,
        paymentMethod: 'simulation',
        metadata: { planName: plan.name, planSlug: plan.slug },
      });

      let profile;
      if (plan.type === 'provider') {
        profile = await activateProviderPlan(req.user._id, plan);
      } else if (plan.type === 'recruiter') {
        profile = await activateRecruiterPlan(req.user._id, plan);
      }

      return res.json({
        success: true,
        simulated: true,
        message: 'Plan activated (simulation mode)',
        payment,
        profile,
      });
    }

    // ---------------------------------------- LIVE STRIPE MODE
    const stripe = await getStripeInstance();

    // Stripe expects currency in lowercase, amount in smallest unit (paise for INR)
    const currency = (plan.currency || 'inr').toLowerCase();
    const unitAmount = Math.round(plan.price * 100);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const planRoute = plan.type === 'recruiter' ? 'recruiter' : 'provider';
    const resolvedSuccessUrl =
      successUrl ||
      `${frontendUrl}/${planRoute}/plans?payment=success&session_id={CHECKOUT_SESSION_ID}`;
    const resolvedCancelUrl =
      cancelUrl || `${frontendUrl}/${planRoute}/plans?payment=cancelled`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: req.user.email || undefined,
      client_reference_id: req.user._id.toString(),
      line_items: [
        {
          price_data: {
            currency,
            product_data: {
              name: `${plan.name} – ServiceHub`,
              description: `${plan.duration}-day access · ${plan.type} plan`,
            },
            unit_amount: unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        userId: req.user._id.toString(),
        planId: plan._id.toString(),
        planName: plan.name,
        planType: plan.type,
        planSlug: plan.slug,
        type: 'plan_purchase',
      },
      success_url: resolvedSuccessUrl,
      cancel_url: resolvedCancelUrl,
    });

    // Persist a 'created' payment record keyed on the Stripe session ID
    const payment = await Payment.create({
      user: req.user._id,
      plan: plan._id,
      amount: plan.price,
      currency: currency.toUpperCase(),
      type: 'plan_purchase',
      status: 'created',
      stripeSessionId: session.id,
      metadata: { planName: plan.name, planSlug: plan.slug },
    });

    res.json({
      success: true,
      simulated: false,
      sessionId: session.id,
      sessionUrl: session.url,  // Frontend redirects to this URL
      payment: payment._id,
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: error.message || 'Failed to create checkout session' });
  }
};

/**
 * @desc    Verify Stripe Checkout Session after user returns to success URL
 * @route   POST /api/payments/verify
 * @access  Private
 * @body    { sessionId }
 */
const verifyPayment = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    const stripe = await getStripeInstance();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Ensure the session belongs to the requesting user
    if (session.client_reference_id !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Session does not belong to this user' });
    }

    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        message: `Payment not completed. Status: ${session.payment_status}`,
      });
    }

    const payment = await Payment.findOneAndUpdate(
      { stripeSessionId: sessionId },
      {
        status: 'completed',
        stripePaymentIntentId: session.payment_intent || '',
        transactionId: session.payment_intent || sessionId,
        paymentMethod: 'card',
      },
      { new: true }
    ).populate('plan');

    if (!payment) {
      return res.status(404).json({ message: 'Payment record not found' });
    }

    let profile;
    const plan = payment.plan;
    if (plan) {
      if (plan.type === 'provider') {
        profile = await activateProviderPlan(payment.user, plan);
      } else if (plan.type === 'recruiter') {
        profile = await activateRecruiterPlan(payment.user, plan);
      }
    }

    res.json({
      success: true,
      message: 'Payment verified and plan activated',
      payment,
      profile,
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Payment verification failed', error: error.message });
  }
};

/**
 * @desc    Record a payment failure / cancellation from frontend
 * @route   POST /api/payments/failed
 * @access  Private
 * @body    { sessionId, errorMessage }
 */
const paymentFailed = async (req, res) => {
  try {
    const { sessionId, errorMessage } = req.body;

    if (sessionId) {
      await Payment.findOneAndUpdate(
        { stripeSessionId: sessionId },
        {
          status: 'failed',
          metadata: { error: errorMessage || 'Payment failed or cancelled' },
        }
      );
    }

    res.json({ success: false, message: 'Payment failure recorded' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Stripe webhook (server-to-server). Must receive raw body.
 *          Registered in server.js BEFORE express.json() middleware.
 * @route   POST /api/payments/webhook
 * @access  Public
 */
const stripeWebhook = async (req, res) => {
  try {
    const config = await getPaymentConfig();
    const stripe = await getStripeInstance();

    let event;

    if (config.webhookSecret) {
      const sig = req.headers['stripe-signature'];
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, config.webhookSecret);
      } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).json({ message: `Webhook Error: ${err.message}` });
      }
    } else {
      // No secret configured – parse body directly (dev/testing only)
      event =
        typeof req.body === 'string' || Buffer.isBuffer(req.body)
          ? JSON.parse(req.body.toString())
          : req.body;
    }

    // --- Handle events ---
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      if (session.payment_status === 'paid') {
        const payment = await Payment.findOneAndUpdate(
          { stripeSessionId: session.id },
          {
            status: 'completed',
            stripePaymentIntentId: session.payment_intent || '',
            transactionId: session.payment_intent || session.id,
            paymentMethod: 'card',
          },
          { new: true }
        ).populate('plan');

        if (payment && payment.plan) {
          if (payment.plan.type === 'provider') {
            await activateProviderPlan(payment.user, payment.plan);
          } else if (payment.plan.type === 'recruiter') {
            await activateRecruiterPlan(payment.user, payment.plan);
          }
        }
      }
    }

    if (
      event.type === 'checkout.session.expired' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      const obj = event.data.object;
      if (obj.id) {
        await Payment.findOneAndUpdate(
          { stripeSessionId: obj.id },
          { status: 'failed' }
        );
      }
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ message: 'Webhook processing failed' });
  }
};

/**
 * @desc    Get payment history for logged-in user
 * @route   GET /api/payments/my-payments
 * @access  Private
 */
const getMyPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ user: req.user._id })
      .populate('plan', 'name price duration type slug')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * @desc    Get single payment details
 * @route   GET /api/payments/:id
 * @access  Private
 */
const getPaymentById = async (req, res) => {
  try {
    const payment = await Payment.findById(req.params.id)
      .populate('plan', 'name price duration type slug features')
      .populate('user', 'name email');

    if (!payment) return res.status(404).json({ message: 'Payment not found' });

    // Only allow own payment or admin
    if (payment.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json(payment);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getPaymentPublicConfig,
  createOrder,
  verifyPayment,
  paymentFailed,
  stripeWebhook,
  getMyPayments,
  getPaymentById,
};
