require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Plan = require('../models/Plan');
const User = require('../models/User');
const UserSubscription = require('../models/UserSubscription');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const AdminSetting = require('../models/AdminSetting');

const shouldWrite = process.argv.includes('--write');

const DURATIONS = [30, 90, 180, 365];
const DEFAULT_DISCOUNTS = { 90: 5, 180: 10, 365: 20 };
const LEGACY_TIER_ALIASES = {
  starter: ['starter', 'basic'],
  business: ['business', 'pro'],
  enterprise: ['enterprise', 'featured'],
};

const roundMoney = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

const derivePriceFromMonthly = (monthlyPrice, duration, discountPercent) => {
  if (duration === 30) return roundMoney(monthlyPrice);
  const months = duration / 30;
  const discountedMultiplier = Math.max(0, 1 - (Number(discountPercent) || 0) / 100);
  return roundMoney(Number(monthlyPrice || 0) * months * discountedMultiplier);
};

const getEffectiveRole = (user) => {
  if (!user) return null;
  if (user.activeRole) return user.activeRole;
  if (Array.isArray(user.roles) && user.roles.length) return user.roles[0];
  return user.role || null;
};

async function ensureDiscountSettings() {
  const entries = [
    { key: 'plan_discount_90', value: DEFAULT_DISCOUNTS[90], description: 'Discount (%) for 3-month plans', category: 'pricing' },
    { key: 'plan_discount_180', value: DEFAULT_DISCOUNTS[180], description: 'Discount (%) for semi-annual plans', category: 'pricing' },
    { key: 'plan_discount_365', value: DEFAULT_DISCOUNTS[365], description: 'Discount (%) for annual plans', category: 'pricing' },
  ];

  const current = await AdminSetting.find({ key: { $in: entries.map((e) => e.key) } }).lean();
  const byKey = new Map(current.map((s) => [s.key, s]));

  const changes = [];
  for (const entry of entries) {
    if (!byKey.has(entry.key)) {
      changes.push({ action: 'create', entry });
      if (shouldWrite) {
        await AdminSetting.create(entry);
      }
    }
  }

  const discounts = {
    90: Number(byKey.get('plan_discount_90')?.value ?? DEFAULT_DISCOUNTS[90]),
    180: Number(byKey.get('plan_discount_180')?.value ?? DEFAULT_DISCOUNTS[180]),
    365: Number(byKey.get('plan_discount_365')?.value ?? DEFAULT_DISCOUNTS[365]),
  };

  return { discounts, changesCount: changes.length };
}

async function migratePlanIndexes() {
  const collection = Plan.collection;
  const indexes = await collection.indexes();

  const slugUnique = indexes.find((idx) => idx.unique && idx.key && idx.key.slug === 1 && Object.keys(idx.key).length === 1);
  if (slugUnique && shouldWrite) {
    await collection.dropIndex(slugUnique.name);
  }

  // Ensure compound uniqueness: type + slug + duration
  if (shouldWrite) {
    await collection.createIndex({ type: 1, slug: 1, duration: 1 }, { unique: true, name: 'type_1_slug_1_duration_1' });
  }

  return {
    droppedSlugUnique: !!slugUnique,
  };
}

async function ensureFreePlans() {
  const freeProviderPayload = {
    name: 'Free',
    slug: 'free',
    type: 'provider',
    duration: 365,
    price: 0,
    isActive: true,
    sortOrder: 0,
    maxSkills: 4,
    boostWeight: 0,
    isRotationEligible: false,
    jobApplyLimit: 2,
    jobPostLimit: 0,
    unlockCredits: 0,
    features: ['Basic listing', '2 job apply / month'],
  };

  const freeRecruiterPayload = {
    name: 'Free',
    slug: 'free',
    type: 'recruiter',
    duration: 365,
    price: 0,
    isActive: true,
    sortOrder: 0,
    unlockCredits: 2,
    jobPostLimit: 2,
    jobApplyLimit: 0,
    features: ['Basic access', '2 contact unlock / month'],
  };

  const updates = [];

  const oldRecruiterFree = await Plan.findOne({ type: 'recruiter', slug: 'free-recruiter' });
  if (oldRecruiterFree && shouldWrite) {
    oldRecruiterFree.slug = 'free';
    oldRecruiterFree.price = 0;
    oldRecruiterFree.unlockCredits = 2;
    oldRecruiterFree.sortOrder = 0;
    oldRecruiterFree.jobPostLimit = 2;
    oldRecruiterFree.duration = oldRecruiterFree.duration || 365;
    await oldRecruiterFree.save();
    updates.push('renamed free-recruiter -> free');
  }

  if (shouldWrite) {
    await Plan.findOneAndUpdate(
      { type: 'provider', slug: 'free', duration: 365 },
      { $set: freeProviderPayload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Plan.findOneAndUpdate(
      { type: 'recruiter', slug: 'free', duration: 365 },
      { $set: freeRecruiterPayload },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  return updates.length;
}

async function syncPaidTierFamilies(discounts) {
  const counters = {
    familiesSynced: 0,
    plansUpserted: 0,
    legacyPlansDisabled: 0,
    profileSlugsMapped: 0,
  };

  for (const type of ['provider', 'recruiter']) {
    for (const [tier, aliases] of Object.entries(LEGACY_TIER_ALIASES)) {
      const monthlySource = await Plan.findOne({
        type,
        slug: { $in: aliases },
        duration: 30,
        isActive: true,
      }).sort({ updatedAt: -1, createdAt: -1 });

      if (!monthlySource || Number(monthlySource.price) <= 0) continue;

      const base = monthlySource.toObject();
      const monthlyPrice = Number(base.price || 0);

      for (const duration of DURATIONS) {
        const discount = duration === 30 ? 0 : (discounts[duration] || 0);
        const price = derivePriceFromMonthly(monthlyPrice, duration, discount);

        const payload = {
          ...base,
          _id: undefined,
          slug: tier,
          name: tier[0].toUpperCase() + tier.slice(1),
          duration,
          price,
          sortOrder: tier === 'starter' ? 1 : tier === 'business' ? 2 : 3,
          isActive: true,
        };

        if (shouldWrite) {
          await Plan.findOneAndUpdate(
            { type, slug: tier, duration },
            { $set: payload },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
        }
        counters.plansUpserted += 1;
      }

      // Disable legacy alias plans for this type/tier to avoid duplicate UI entries.
      if (shouldWrite) {
        const aliasesToDisable = aliases.filter((a) => a !== tier);
        if (aliasesToDisable.length) {
          const disabled = await Plan.updateMany(
            { type, slug: { $in: aliasesToDisable } },
            { $set: { isActive: false, status: 'inactive' } }
          );
          counters.legacyPlansDisabled += disabled.modifiedCount || 0;
        }
      }

      counters.familiesSynced += 1;
    }
  }

  if (shouldWrite) {
    const r1 = await ProviderProfile.updateMany({ currentPlan: 'basic' }, { $set: { currentPlan: 'starter' } });
    const r2 = await ProviderProfile.updateMany({ currentPlan: 'pro' }, { $set: { currentPlan: 'business' } });
    const r3 = await ProviderProfile.updateMany({ currentPlan: 'featured' }, { $set: { currentPlan: 'enterprise' } });
    counters.profileSlugsMapped += (r1.modifiedCount || 0) + (r2.modifiedCount || 0) + (r3.modifiedCount || 0);
  }

  return counters;
}

async function ensureSubscriptionRolesAndFreeFallback() {
  const now = new Date();
  const counters = {
    rolesBackfilled: 0,
    freeSubsCreated: 0,
    profilePlansSynced: 0,
  };

  const subscriptions = await UserSubscription.find({
    $or: [{ role: { $exists: false } }, { role: null }, { role: '' }],
  }).populate('planId', 'type');

  for (const sub of subscriptions) {
    const role = sub.planId?.type;
    if (!role) continue;
    if (shouldWrite) {
      sub.role = role;
      await sub.save();
    }
    counters.rolesBackfilled += 1;
  }

  const users = await User.find({});
  const freePlanByRole = {
    provider: await Plan.findOne({ type: 'provider', slug: 'free', price: 0, isActive: true }).sort({ sortOrder: 1 }),
    recruiter: await Plan.findOne({ type: 'recruiter', slug: 'free', price: 0, isActive: true }).sort({ sortOrder: 1 }),
  };

  for (const user of users) {
    for (const role of ['provider', 'recruiter']) {
      const roles = Array.isArray(user.roles) ? user.roles : (user.role ? [user.role] : []);
      if (!roles.includes(role) && user.activeRole !== role) continue;

      const active = await UserSubscription.findOne({
        userId: user._id,
        role,
        status: 'active',
        endDate: { $gt: now },
      }).populate('planId');

      let activePlan = active?.planId || null;

      if (!active && freePlanByRole[role]) {
        if (shouldWrite) {
          await UserSubscription.create({
            userId: user._id,
            role,
            planId: freePlanByRole[role]._id,
            startDate: now,
            endDate: new Date(now.getTime() + Number(freePlanByRole[role].duration || 365) * 24 * 60 * 60 * 1000),
            status: 'active',
            isDefault: false,
          });
        }
        activePlan = freePlanByRole[role];
        counters.freeSubsCreated += 1;
      }

      if (!activePlan) continue;

      if (role === 'provider' && shouldWrite) {
        const updated = await ProviderProfile.findOneAndUpdate(
          { user: user._id },
          {
            currentPlan: activePlan.slug,
            planExpiresAt: active?.endDate || undefined,
          }
        );
        if (updated) counters.profilePlansSynced += 1;
      }

      if (role === 'recruiter' && shouldWrite) {
        const patch = {
          currentPlan: activePlan.slug,
          planExpiresAt: active?.endDate || undefined,
        };

        if (activePlan.slug === 'free') {
          patch.unlocksRemaining = 2;
          patch.unlockPackSize = 2;
          patch.freeUnlockResetAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        }

        const updated = await RecruiterProfile.findOneAndUpdate({ user: user._id }, patch);
        if (updated) counters.profilePlansSynced += 1;
      }
    }
  }

  return counters;
}

async function run() {
  await connectDB();

  console.log(`Mode: ${shouldWrite ? 'WRITE' : 'DRY-RUN'}`);

  const discountResult = await ensureDiscountSettings();
  const indexResult = await migratePlanIndexes();
  const freeResult = await ensureFreePlans();
  const familyResult = await syncPaidTierFamilies(discountResult.discounts);
  const subscriptionResult = await ensureSubscriptionRolesAndFreeFallback();

  console.log('Migration summary:', {
    discountSettingsCreated: discountResult.changesCount,
    droppedLegacySlugUniqueIndex: indexResult.droppedSlugUnique,
    freePlanOps: freeResult,
    familyResult,
    subscriptionResult,
  });

  if (!shouldWrite) {
    console.log('Dry run complete. Re-run with --write to apply changes.');
  }

  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
