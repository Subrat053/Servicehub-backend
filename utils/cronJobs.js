const cron = require('node-cron');
const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const UserSubscription = require('../models/UserSubscription');
const Plan = require('../models/Plan');
const WhatsappLog = require('../models/WhatsappLog');
const Notification = require('../models/Notification');
const { sendWhatsAppMessage, formatPhoneNumber } = require('./messaging');
const { clearUserBadge } = require('../services/badgeService');
const { createNotification } = require('../services/notificationService');

/**
 * Check subscription expiry and send renewal reminders
 * Runs daily at 9:00 AM
 */
const startCronJobs = () => {
  // Daily renewal check at 9:00 AM
  cron.schedule('0 9 * * *', async () => {
    console.log('[CRON] Running daily renewal check...');
    try {
      await checkProviderRenewals();
      await checkRecruiterRenewals();
      await sendPlanExpiryReminders();
      await revertExpiredSubscriptions();
    } catch (err) {
      console.error('[CRON] Renewal check error:', err.message);
    }
  });

  // Rotation pool cleanup every hour
  cron.schedule('0 * * * *', async () => {
    try {
      await cleanupExpiredProfiles();
    } catch (err) {
      console.error('[CRON] Cleanup error:', err.message);
    }
  });

  console.log('[CRON] Scheduled jobs started');
};

async function checkProviderRenewals() {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 30-day reminder
  const providers30 = await ProviderProfile.find({
    profileExpiresAt: { $lte: thirtyDaysFromNow, $gt: sevenDaysFromNow },
    renewalReminderSent: false,
  }).populate('user', 'name phone whatsappNumber whatsappAlerts');

  for (const profile of providers30) {
    const user = profile.user;
    if (!user) continue;

    profile.renewalReminderSent = true;
    await profile.save();

    const phone = user.whatsappNumber || user.phone;
    if (phone && user.whatsappAlerts !== false) {
      try {
        await sendWhatsAppMessage(phone, 'renewal_reminder', {
          name: user.name,
          expiresAt: profile.profileExpiresAt.toLocaleDateString(),
        });
        await WhatsappLog.create({
          user: user._id,
          phone,
          templateName: 'renewal_reminder',
          message: `30-day renewal reminder for ${user.name}`,
          status: 'sent',
          triggerEvent: 'renewal_reminder_30d',
        });
      } catch (err) {
        console.error(`[CRON] WhatsApp renewal reminder failed for ${user.name}:`, err.message);
      }
    }
  }

  // 7-day urgent reminder
  const providers7 = await ProviderProfile.find({
    profileExpiresAt: { $lte: sevenDaysFromNow, $gt: now },
    renewalReminderSent: true, // already got 30-day reminder
  }).populate('user', 'name phone whatsappNumber whatsappAlerts');

  for (const profile of providers7) {
    const user = profile.user;
    if (!user) continue;

    const phone = user.whatsappNumber || user.phone;
    if (phone) {
      try {
        await sendWhatsAppMessage(phone, 'renewal_urgent', {
          name: user.name,
          daysLeft: Math.ceil((profile.profileExpiresAt - now) / (24 * 60 * 60 * 1000)),
        });
        await WhatsappLog.create({
          user: user._id,
          phone,
          templateName: 'renewal_urgent',
          message: `7-day urgent renewal reminder for ${user.name}`,
          status: 'sent',
          triggerEvent: 'renewal_reminder_7d',
        });
      } catch (err) {
        console.error(`[CRON] WhatsApp urgent reminder failed for ${user.name}:`, err.message);
      }
    }
  }

  console.log(`[CRON] Provider renewals: ${providers30.length} (30d), ${providers7.length} (7d)`);
}

async function sendPlanExpiryReminders() {
  const now = new Date();
  const maxWindow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const subscriptions = await UserSubscription.find({
    status: 'active',
    endDate: { $gt: now, $lte: maxWindow },
  }).populate('userId', 'name').populate('planId', 'name');

  const milestones = [30, 7, 1];
  let sent = 0;

  for (const sub of subscriptions) {
    if (!sub.userId || !sub.planId) continue;

    const daysLeft = Math.ceil((sub.endDate - now) / (24 * 60 * 60 * 1000));
    const milestone = milestones.find((d) => daysLeft <= d && daysLeft > d - 1);
    if (!milestone) continue;

    const existing = await Notification.findOne({
      userId: sub.userId._id,
      type: 'PLAN_EXPIRY_REMINDER',
      'data.subscriptionId': sub._id,
      'data.milestoneDays': milestone,
    }).lean();

    if (existing) continue;

    await createNotification({
      userId: sub.userId._id,
      type: 'PLAN_EXPIRY_REMINDER',
      title: 'Plan Expiry Reminder',
      message: `Your ${sub.planId.name} plan expires in ${daysLeft} day${daysLeft > 1 ? 's' : ''}`,
      data: {
        subscriptionId: sub._id,
        planId: sub.planId._id,
        milestoneDays: milestone,
        daysLeft,
        expiresAt: sub.endDate,
      },
    });
    sent += 1;
  }

  if (sent > 0) {
    console.log(`[CRON] Sent ${sent} in-app plan expiry reminders`);
  }
}

async function checkRecruiterRenewals() {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const recruiters = await RecruiterProfile.find({
    profileExpiresAt: { $lte: thirtyDaysFromNow, $gt: now },
    renewalReminderSent: false,
  }).populate('user', 'name phone whatsappNumber whatsappAlerts');

  for (const profile of recruiters) {
    const user = profile.user;
    if (!user) continue;

    profile.renewalReminderSent = true;
    await profile.save();

    const phone = user.whatsappNumber || user.phone;
    if (phone && user.whatsappAlerts !== false) {
      try {
        await sendWhatsAppMessage(phone, 'renewal_reminder', {
          name: user.name,
          expiresAt: profile.profileExpiresAt.toLocaleDateString(),
        });
        await WhatsappLog.create({
          user: user._id,
          phone,
          templateName: 'renewal_reminder',
          message: `Renewal reminder for recruiter ${user.name}`,
          status: 'sent',
          triggerEvent: 'renewal_reminder_recruiter',
        });
      } catch (err) {
        console.error(`[CRON] WhatsApp recruiter reminder failed:`, err.message);
      }
    }
  }

  console.log(`[CRON] Recruiter renewals: ${recruiters.length}`);
}

async function cleanupExpiredProfiles() {
  const now = new Date();

  // Deactivate expired provider profiles (remove from rotation pool)
  const expired = await ProviderProfile.find({
    profileExpiresAt: { $lt: now },
    inRotationPool: true,
  });

  for (const profile of expired) {
    profile.inRotationPool = false;
    profile.isTopCity = false;
    await profile.save();

    // Remove from rotation pools
    const RotationPool = require('../models/RotationPool');
    await RotationPool.updateMany(
      {},
      { $pull: { providers: { provider: profile._id } } }
    );
  }

  if (expired.length > 0) {
    console.log(`[CRON] Removed ${expired.length} expired providers from rotation pools`);
  }
}

/**
 * Revert expired subscriptions to the free plan.
 * Marks expired UserSubscription records and assigns a free plan.
 */
async function revertExpiredSubscriptions() {
  const now = new Date();

  // Find all active subscriptions that have expired
  const expiredSubs = await UserSubscription.find({
    status: 'active',
    endDate: { $lt: now },
  }).populate('userId', 'roles activeRole role');

  let reverted = 0;
  for (const sub of expiredSubs) {
    sub.status = 'expired';
    await sub.save();

    if (!sub.userId) continue;

    // Find the free plan for this user's role
    const fallbackRole = sub.userId.activeRole || sub.userId.role || (Array.isArray(sub.userId.roles) ? sub.userId.roles[0] : null);
    const planType = sub.role || (fallbackRole === 'recruiter' ? 'recruiter' : 'provider');
    const freePlan = await Plan.findOne({ type: planType, price: 0, isActive: true }).sort({ sortOrder: 1 });

    if (freePlan) {
      await UserSubscription.create({
        userId: sub.userId._id,
        role: planType,
        planId: freePlan._id,
        startDate: now,
        endDate: new Date(now.getTime() + freePlan.duration * 24 * 60 * 60 * 1000),
        status: 'active',
      });

      // Update profile plan slug to free
      if (planType === 'provider') {
        await ProviderProfile.findOneAndUpdate({ user: sub.userId._id }, {
          currentPlan: 'free',
          boostWeight: 0,
          isTopCity: false,
          inRotationPool: false,
        });
      } else if (planType === 'recruiter') {
        const resetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        await RecruiterProfile.findOneAndUpdate({ user: sub.userId._id }, {
          currentPlan: 'free',
          unlocksRemaining: 2,
          unlockPackSize: 2,
          freeUnlockResetAt: resetAt,
        });
      }
    }

    // Clear badge
    await clearUserBadge(sub.userId._id);
    reverted++;
  }

  if (reverted > 0) {
    console.log(`[CRON] Reverted ${reverted} expired subscriptions to free plan`);
  }
}

module.exports = { startCronJobs };
