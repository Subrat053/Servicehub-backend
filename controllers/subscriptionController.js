const UserSubscription = require('../models/UserSubscription');
const Plan = require('../models/Plan');
const User = require('../models/User');
const Payment = require('../models/Payment');
const AdminSetting = require('../models/AdminSetting');
const ProviderProfile = require('../models/ProviderProfile');
const { updateUserBadge } = require('../services/badgeService');

// @desc    Get my active subscription
// @route   GET /api/subscriptions/me
const getMySubscription = async (req, res) => {
  try {
    const subscription = await UserSubscription.findOne({
      userId: req.user._id,
      status: 'active',
      endDate: { $gt: new Date() },
    }).populate('planId');

    if (!subscription) {
      return res.json({ subscription: null, message: 'No active subscription' });
    }
    res.json({ subscription });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Activate subscription after payment (called internally or by admin)
// @route   POST /api/subscriptions/activate
const activateSubscription = async (req, res) => {
  try {
    const { userId, planId } = req.body;

    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    const subscription = await assignPlanToUser(userId, plan);
    res.json({ message: 'Subscription activated', subscription });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Admin: View all subscriptions
// @route   GET /api/subscriptions/all
const getAllSubscriptions = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const subscriptions = await UserSubscription.find(filter)
      .populate('userId', 'name email role')
      .populate('planId', 'name price type')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await UserSubscription.countDocuments(filter);
    res.json({
      subscriptions,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Admin: View revenue stats
// @route   GET /api/subscriptions/revenue
const getRevenue = async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalRevenue, monthlyRevenue, activeSubscriptions] = await Promise.all([
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Payment.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      UserSubscription.countDocuments({ status: 'active', endDate: { $gt: now } }),
    ]);

    res.json({
      totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
      monthlyRevenue: monthlyRevenue.length > 0 ? monthlyRevenue[0].total : 0,
      activeSubscriptions,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * Helper: assign a plan to a user.
 * Expires any existing active subscription, then creates a new one.
 * Also updates the user's badge.
 */
async function assignPlanToUser(userId, plan, options = {}) {
  const isDefault = options.isDefault === true;

  // Expire any existing active subscription
  await UserSubscription.updateMany(
    { userId, status: 'active' },
    { status: 'expired' }
  );

  const subscription = await UserSubscription.create({
    userId,
    planId: plan._id,
    startDate: new Date(),
    endDate: new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000),
    status: 'active',
    isDefault,
  });

  // Update badge
  await updateUserBadge(userId);

  return subscription;
}

/**
 * Helper: assign the free plan to a user.
 * Finds the free plan for the user's role and creates a subscription.
 */
async function assignFreePlan(userId, role) {
  const planType = role === 'recruiter' ? 'recruiter' : 'provider';
  const freePlan = await Plan.findOne({
    type: planType,
    price: 0,
    isActive: true,
  }).sort({ sortOrder: 1 });

  if (!freePlan) {
    // No free plan configured; skip
    return null;
  }

  return assignPlanToUser(userId, freePlan, { isDefault: false });
}

async function getDefaultProviderSubscriptionConfig() {
  const keys = [
    'default_provider_subscription_enabled',
    'default_provider_plan_slug',
    'default_provider_plan_duration_days',
  ];

  const settings = await AdminSetting.find({ key: { $in: keys } });
  const map = {};
  settings.forEach(s => { map[s.key] = s.value; });

  const enabledValue = map.default_provider_subscription_enabled;
  const enabled = enabledValue !== false && enabledValue !== 'false';

  return {
    enabled,
    planSlug: typeof map.default_provider_plan_slug === 'string' ? map.default_provider_plan_slug : 'basic',
    durationDays: Number(map.default_provider_plan_duration_days) || 30,
  };
}

async function findDefaultProviderPlan(planSlug, durationDays) {
  if (planSlug) {
    const bySlug = await Plan.findOne({ type: 'provider', slug: planSlug, isActive: true });
    if (bySlug) return bySlug;
  }

  if (durationDays) {
    const byDuration = await Plan.findOne({ type: 'provider', duration: durationDays, isActive: true })
      .sort({ price: 1, sortOrder: 1 });
    if (byDuration) return byDuration;
  }

  return Plan.findOne({ type: 'provider', isActive: true }).sort({ price: 1, sortOrder: 1 });
}

/**
 * Ensure provider has a default monthly subscription if none exists.
 * Returns existing or newly created subscription, or null if disabled.
 */
async function ensureDefaultProviderSubscription(userId, options = {}) {
  const { enabled, planSlug, durationDays } = await getDefaultProviderSubscriptionConfig();
  if (!enabled) return null;

  const existing = await UserSubscription.findOne({ userId }).sort({ createdAt: -1 });
  if (existing) return existing;

  const plan = await findDefaultProviderPlan(planSlug, durationDays);
  if (!plan) return null;

  const startDate = options.startDate ? new Date(options.startDate) : new Date();
  const planDays = durationDays || plan.duration || 30;
  const endDate = new Date(startDate.getTime() + planDays * 24 * 60 * 60 * 1000);

  const subscription = await UserSubscription.create({
    userId,
    planId: plan._id,
    startDate,
    endDate,
    status: 'active',
    isDefault: true,
  });

  await ProviderProfile.findOneAndUpdate(
    { user: userId },
    {
      currentPlan: plan.slug,
      planExpiresAt: endDate,
      boostWeight: plan.boostWeight || 0,
      isTopCity: plan.isRotationEligible === true,
      inRotationPool: plan.isRotationEligible === true,
    }
  );

  await updateUserBadge(userId);

  return subscription;
}

module.exports = {
  getMySubscription,
  activateSubscription,
  getAllSubscriptions,
  getRevenue,
  assignPlanToUser,
  assignFreePlan,
  ensureDefaultProviderSubscription,
};
