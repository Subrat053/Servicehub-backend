const UserSubscription = require('../models/UserSubscription');
const Plan = require('../models/Plan');
const User = require('../models/User');
const Payment = require('../models/Payment');
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
async function assignPlanToUser(userId, plan) {
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

  return assignPlanToUser(userId, freePlan);
}

module.exports = {
  getMySubscription,
  activateSubscription,
  getAllSubscriptions,
  getRevenue,
  assignPlanToUser,
  assignFreePlan,
};
