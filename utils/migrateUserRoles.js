require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const UserSubscription = require('../models/UserSubscription');

const shouldWrite = process.argv.includes('--write');
const unsetLegacyRole = process.argv.includes('--unset-legacy-role');

const deriveUserRoles = (user) => {
  const roles = Array.isArray(user.roles) ? [...new Set(user.roles)] : [];

  if (user.role && !roles.includes(user.role)) roles.push(user.role);

  const validRoles = roles.filter((role) => ['provider', 'recruiter', 'admin'].includes(role));
  const activeRole = user.activeRole && validRoles.includes(user.activeRole)
    ? user.activeRole
    : (validRoles[0] || null);

  return { roles: validRoles, activeRole };
};

const resolveSubscriptionRole = (subscription, userById) => {
  if (subscription.role) return subscription.role;

  const planType = subscription.planId && subscription.planId.type;
  if (planType === 'provider' || planType === 'recruiter') return planType;

  const user = userById.get(subscription.userId.toString());
  if (!user) return null;

  if (user.activeRole === 'provider' || user.activeRole === 'recruiter') return user.activeRole;

  const firstRole = (user.roles || []).find((role) => role === 'provider' || role === 'recruiter');
  return firstRole || null;
};

const run = async () => {
  await connectDB();

  const users = await User.find({}).select('+role roles activeRole').lean();
  const userOps = [];
  const userById = new Map();

  for (const user of users) {
    const derived = deriveUserRoles(user);
    userById.set(user._id.toString(), derived);

    const currentRoles = Array.isArray(user.roles) ? user.roles : [];
    const currentActiveRole = user.activeRole || null;

    const needsRoleArrayUpdate = JSON.stringify(currentRoles) !== JSON.stringify(derived.roles);
    const needsActiveRoleUpdate = currentActiveRole !== derived.activeRole;

    if (!needsRoleArrayUpdate && !needsActiveRoleUpdate && !unsetLegacyRole) continue;

    const update = { $set: { roles: derived.roles, activeRole: derived.activeRole } };
    if (unsetLegacyRole) {
      update.$unset = { role: '' };
    }

    userOps.push({
      updateOne: {
        filter: { _id: user._id },
        update,
      },
    });
  }

  const subscriptions = await UserSubscription.find({
    $or: [{ role: { $exists: false } }, { role: null }, { role: '' }],
  })
    .populate('planId', 'type')
    .select('_id userId role planId')
    .lean();

  const subscriptionOps = [];
  let unresolvedSubscriptions = 0;

  for (const subscription of subscriptions) {
    const derivedRole = resolveSubscriptionRole(subscription, userById);
    if (!derivedRole) {
      unresolvedSubscriptions += 1;
      continue;
    }

    subscriptionOps.push({
      updateOne: {
        filter: { _id: subscription._id },
        update: { $set: { role: derivedRole } },
      },
    });
  }

  console.log('User migration preview:', {
    totalUsers: users.length,
    updatesPrepared: userOps.length,
    unsetLegacyRole,
  });
  console.log('Subscription migration preview:', {
    missingRoleDocs: subscriptions.length,
    updatesPrepared: subscriptionOps.length,
    unresolvedSubscriptions,
  });

  if (!shouldWrite) {
    console.log('Dry run complete. Re-run with --write to apply changes.');
    await mongoose.disconnect();
    return;
  }

  if (userOps.length > 0) {
    const userResult = await User.bulkWrite(userOps, { ordered: false });
    console.log('User migration applied:', {
      matchedCount: userResult.matchedCount,
      modifiedCount: userResult.modifiedCount,
    });
  } else {
    console.log('No user updates required.');
  }

  if (subscriptionOps.length > 0) {
    const subscriptionResult = await UserSubscription.bulkWrite(subscriptionOps, { ordered: false });
    console.log('Subscription migration applied:', {
      matchedCount: subscriptionResult.matchedCount,
      modifiedCount: subscriptionResult.modifiedCount,
    });
  } else {
    console.log('No subscription updates required.');
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Role migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
