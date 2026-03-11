const User = require('../models/User');
const Plan = require('../models/Plan');
const UserSubscription = require('../models/UserSubscription');

/**
 * Determine the badge text for a user based on their active subscription plan.
 * Returns empty string if the plan does not have badgeEnabled.
 */
function getBadgeText(plan, role) {
  if (!plan || !plan.badgeEnabled) return '';
  const roleName = role === 'recruiter' ? 'Recruiter' : 'Provider';
  return `⭐ ${plan.name} ${roleName}`;
}

/**
 * Update a user's subscriptionBadge based on their active subscription.
 */
async function updateUserBadge(userId) {
  const sub = await UserSubscription.findOne({
    userId,
    status: 'active',
    endDate: { $gt: new Date() },
  }).populate('planId');

  const user = await User.findById(userId);
  if (!user) return;

  const badge = sub ? getBadgeText(sub.planId, user.role) : '';
  if (user.subscriptionBadge !== badge) {
    user.subscriptionBadge = badge;
    await user.save();
  }
  return badge;
}

/**
 * Clear the badge when plan expires or is cancelled.
 */
async function clearUserBadge(userId) {
  await User.findByIdAndUpdate(userId, { subscriptionBadge: '' });
}

module.exports = { getBadgeText, updateUserBadge, clearUserBadge };
