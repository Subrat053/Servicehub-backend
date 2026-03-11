const UserSubscription = require('../models/UserSubscription');
const Plan = require('../models/Plan');
const JobPost = require('../models/JobPost');
const Application = require('../models/Application');

/**
 * Get the active subscription + plan for a user.
 * Returns { subscription, plan } or { subscription: null, plan: null }.
 */
async function getActiveSubscription(userId) {
  const subscription = await UserSubscription.findOne({
    userId,
    status: 'active',
    endDate: { $gt: new Date() },
  }).populate('planId');

  if (!subscription) return { subscription: null, plan: null };
  return { subscription, plan: subscription.planId };
}

/**
 * Middleware: check recruiter's job post limit before creating a job.
 * Uses active subscription if available, otherwise falls back to free plan.
 */
const checkPostLimit = async (req, res, next) => {
  try {
    let { subscription, plan } = await getActiveSubscription(req.user._id);

    // If no active subscription, use the free recruiter plan as default
    if (!plan) {
      plan = await Plan.findOne({ type: 'recruiter', slug: 'free-recruiter' });
      if (!plan) {
        return res.status(500).json({
          message: 'Free recruiter plan not configured. Please contact support.',
        });
      }
    }

    // -1 means unlimited
    if (plan.jobPostLimit === -1) return next();

    // Count jobs posted this calendar month
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const jobsThisMonth = await JobPost.countDocuments({
      recruiter: req.user._id,
      createdAt: { $gte: startOfMonth },
    });

    if (jobsThisMonth >= plan.jobPostLimit) {
      return res.status(403).json({
        message: `Job post limit of ${plan.jobPostLimit} reached for this month. Upgrade your plan.`,
        upgradeRequired: true,
        limit: plan.jobPostLimit,
        used: jobsThisMonth,
      });
    }

    // Attach subscription data for downstream use
    req.subscription = subscription;
    req.plan = plan;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * Middleware: check provider's job application limit before applying.
 * Uses active subscription if available, otherwise falls back to free plan.
 */
const checkApplyLimit = async (req, res, next) => {
  try {
    let { subscription, plan } = await getActiveSubscription(req.user._id);

    // If no active subscription, use the free plan as default
    if (!plan) {
      plan = await Plan.findOne({ type: 'provider', slug: 'free' });
      if (!plan) {
        return res.status(500).json({
          message: 'Free plan not configured. Please contact support.',
        });
      }
    }

    // -1 means unlimited
    if (plan.jobApplyLimit === -1) return next();

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const appliedThisMonth = await Application.countDocuments({
      provider: req.user._id,
      createdAt: { $gte: startOfMonth },
    });

    if (appliedThisMonth >= plan.jobApplyLimit) {
      return res.status(403).json({
        message: `Application limit of ${plan.jobApplyLimit} reached for this month. Upgrade your plan.`,
        upgradeRequired: true,
        limit: plan.jobApplyLimit,
        used: appliedThisMonth,
      });
    }

    req.subscription = subscription;
    req.plan = plan;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

/**
 * Middleware: attach active subscription to request (non-blocking — continues even without sub).
 * Safe to use on public routes where req.user may not exist.
 */
const attachSubscription = async (req, res, next) => {
  try {
    if (req.user) {
      const { subscription, plan } = await getActiveSubscription(req.user._id);
      req.subscription = subscription;
      req.plan = plan;
    }
  } catch (_) {
    // Non-blocking
  }
  next();
};

module.exports = { checkPostLimit, checkApplyLimit, attachSubscription, getActiveSubscription };
