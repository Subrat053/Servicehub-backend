const ProviderProfile = require('../models/ProviderProfile');
const User = require('../models/User');
const Lead = require('../models/Lead');
const RotationPool = require('../models/RotationPool');
const Payment = require('../models/Payment');
const Plan = require('../models/Plan');
const Review = require('../models/Review');
const VisitHistory = require('../models/VisitHistory');
const WhatsappLog = require('../models/WhatsappLog');
const JobPost = require('../models/JobPost');
const Application = require('../models/Application');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { sendWhatsAppMessage } = require('../utils/messaging');
const { createNotification } = require('../services/notificationService');
const { getActiveSubscription } = require('../middleware/subscription');
const { assignPlanToUser, assignFreePlan } = require('./subscriptionController');
const { getCoordinatesFromText, upsertLocationRecord } = require('../services/locationService');
const path = require('path');
const fs = require('fs');

const toCoordinate = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
};

// @desc    Get provider profile (own)
// @route   GET /api/provider/profile
const getMyProfile = async (req, res) => {
  try {
    let profile = await ProviderProfile.findOne({ user: req.user._id }).populate('user', 'name email phone avatar profilePhoto');
    if (!profile) {
      // Auto-create if missing (data-recovery for legacy accounts)
      profile = await ProviderProfile.create({
        user: req.user._id,
        profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
      profile = await ProviderProfile.findOne({ user: req.user._id }).populate('user', 'name email phone avatar profilePhoto');
    }
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update provider profile
// @route   PUT /api/provider/profile
const updateProfile = async (req, res) => {
  try {
    const {
      skills, tier, experience, city, state, languages,
      description, portfolioLinks, photo, documents,
      whatsappAlerts, nearestLocation, latitude, longitude,
    } = req.body;

    let profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) {
      profile = await ProviderProfile.create({
        user: req.user._id,
        profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }
    const FREE_LIMIT = parseInt(process.env.FREE_SKILLS_LIMIT || 4);
    if (skills && skills.length > FREE_LIMIT && profile.currentPlan === 'free') {
      return res.status(403).json({
        message: `Free plan allows max ${FREE_LIMIT} skills. Upgrade to add more.`,
        upgradeRequired: true,
      });
    }

    if (skills !== undefined) profile.skills = skills;
    if (tier !== undefined) profile.tier = tier;
    if (experience !== undefined) profile.experience = experience;
    if (city !== undefined) profile.city = city;
    if (state !== undefined) profile.state = state;
    if (typeof nearestLocation === 'string') profile.nearestLocation = nearestLocation.trim();
    const nextLat = toCoordinate(latitude, -90, 90);
    const nextLng = toCoordinate(longitude, -180, 180);
    if (nextLat !== null && nextLng !== null) {
      profile.latitude = nextLat;
      profile.longitude = nextLng;
      profile.locationUpdatedAt = new Date();
    }
    if (languages !== undefined) profile.languages = languages;
    if (description !== undefined) profile.description = description;
    if (portfolioLinks !== undefined) profile.portfolioLinks = portfolioLinks;
    if (photo !== undefined) profile.photo = photo;
    if (documents !== undefined) profile.documents = documents;
    if (whatsappAlerts !== undefined) profile.whatsappAlerts = whatsappAlerts;

    // Update user name/avatar if provided
    if (req.body.name) {
      await User.findByIdAndUpdate(req.user._id, { name: req.body.name });
    }
    if (req.body.avatar) {
      await User.findByIdAndUpdate(req.user._id, { avatar: req.body.avatar });
    }

    // Calculate profile completion
    let completion = 0;
    const fields = [
      profile.skills.length > 0,
      !!profile.experience,
      !!profile.city,
      profile.languages.length > 0,
      !!profile.description,
      !!profile.photo,
    ];
    completion = Math.round((fields.filter(Boolean).length / fields.length) * 100);
    profile.profileCompletion = completion;

    await profile.save();

    if (profile.city) {
      let lat = profile.latitude;
      let lon = profile.longitude;

      if (lat === null || lon === null) {
        const geocoded = await getCoordinatesFromText([profile.city, profile.state].filter(Boolean).join(', '));
        if (geocoded) {
          lat = geocoded.lat;
          lon = geocoded.lon;
          profile.latitude = lat;
          profile.longitude = lon;
          profile.locationUpdatedAt = new Date();
          await profile.save();
        }
      }

      if (lat !== null && lon !== null) {
        await upsertLocationRecord({
          name: profile.nearestLocation || profile.city,
          latitude: lat,
          longitude: lon,
          type: 'provider',
        });
      }
    }

    // Update rotation pool if applicable
    if (skills && city && profile.currentPlan !== 'free') {
      for (const skill of profile.skills) {
        await updateRotationPool(skill, profile.city, profile._id);
      }
    }

    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

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

// @desc    Get provider dashboard stats
// @route   GET /api/provider/dashboard
const getDashboard = async (req, res) => {
  try {
    let profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) {
      profile = await ProviderProfile.create({
        user: req.user._id,
        profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }

    const leads = await Lead.find({ provider: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('recruiter', 'name email');

    const reviews = await Review.find({ provider: req.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('recruiter', 'name');

    // Subscription data
    let { subscription, plan } = await getActiveSubscription(req.user._id, 'provider');
    if (!plan) {
      await assignFreePlan(req.user._id, 'provider');
      const refreshed = await getActiveSubscription(req.user._id, 'provider');
      subscription = refreshed.subscription;
      plan = refreshed.plan;
    }
    const user = await User.findById(req.user._id).select('subscriptionBadge');
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [availableJobs, appliedJobs] = await Promise.all([
      JobPost.countDocuments({ status: 'active', expiresAt: { $gt: now } }),
      Application.countDocuments({ provider: req.user._id }),
    ]);

    const appliedThisMonth = await Application.countDocuments({
      provider: req.user._id,
      createdAt: { $gte: startOfMonth },
    });

    const remainingApplyLimit = plan
      ? (plan.jobApplyLimit === -1 ? 'unlimited' : Math.max(0, plan.jobApplyLimit - appliedThisMonth))
      : 0;

    const planName = plan?.name || (subscription?.isDefault ? 'Monthly' : null);

    res.json({
      profile,
      leads,
      reviews,
      subscription: subscription
        ? {
          status: subscription.status,
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          isDefault: subscription.isDefault === true,
          planName: planName || plan?.slug || 'Free',
        }
        : null,
      stats: {
        profileViews: profile.profileViews,
        leadsReceived: profile.leadsReceived,
        contactsUnlocked: profile.contactsUnlocked,
        profileCompletion: profile.profileCompletion,
        currentPlan: profile.currentPlan,
        profileExpiresAt: profile.profileExpiresAt,
        planName: planName || profile.currentPlan || 'Free',
        planStatus: subscription?.status || 'inactive',
        planEndDate: subscription?.endDate || null,
        isDefaultPlan: subscription?.isDefault === true,
        availableJobs,
        appliedJobs,
        remainingApplyLimit,
        subscriptionBadge: user?.subscriptionBadge || '',
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get provider plans
// @route   GET /api/provider/plans
const getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ type: 'provider', isActive: true }).sort({ sortOrder: 1 });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Purchase a plan (simulated)
// @route   POST /api/provider/plans/purchase
const purchasePlan = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    if (plan.type !== 'provider') {
      return res.status(400).json({ message: 'Invalid plan type for provider purchase' });
    }

    let profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) {
      profile = await ProviderProfile.create({
        user: req.user._id,
        profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      });
    }

    if (profile.currentPlan) {
      const currentPlan = await Plan.findOne({ type: 'provider', slug: profile.currentPlan });
      const currentOrder = Number(currentPlan?.sortOrder || 0);
      const nextOrder = Number(plan.sortOrder || 0);
      if (nextOrder <= currentOrder) {
        return res.status(400).json({
          message: `Only upgrades are allowed. Your current plan is '${currentPlan?.name || profile.currentPlan}'. Please choose a higher plan.`,
        });
      }
    }

    // Create payment record (simulated)
    const payment = await Payment.create({
      user: req.user._id,
      plan: plan._id,
      amount: plan.price,
      currency: plan.currency,
      type: 'plan_purchase',
      status: 'completed',
      transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    // Update provider profile
    profile.currentPlan = plan.slug;
    profile.planExpiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
    profile.boostWeight = plan.boostWeight;
    profile.isTopCity = plan.isRotationEligible;
    profile.inRotationPool = plan.isRotationEligible;
    await profile.save();

    // Add to rotation pool if eligible
    if (plan.isRotationEligible && profile.skills.length > 0 && profile.city) {
      for (const skill of profile.skills) {
        await updateRotationPool(skill, profile.city, profile._id);
      }
    }

    // Create UserSubscription record and update badge
    await assignPlanToUser(req.user._id, 'provider', plan);

    await createNotification({
      userId: req.user._id,
      type: 'PLAN_PURCHASED',
      title: 'Plan Purchased',
      message: `Your ${plan.name} plan has been activated successfully`,
      data: {
        planId: plan._id,
        planSlug: plan.slug,
        paymentId: payment._id,
      },
    });

    res.json({ message: 'Plan purchased successfully', payment, profile });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get my leads
// @route   GET /api/provider/leads
const getMyLeads = async (req, res) => {
  try {
    const leads = await Lead.find({ provider: req.user._id })
      .sort({ createdAt: -1 })
      .populate('recruiter', 'name email phone')
      .populate('jobPost', 'title skill city');
    res.json(leads);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update lead status
// @route   PUT /api/provider/leads/:id
const updateLeadStatus = async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });
    if (lead.provider.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    lead.status = req.body.status || lead.status;
    await lead.save();
    res.json(lead);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get public provider profile by ID
// @route   GET /api/provider/public/:id
const getPublicProfile = async (req, res) => {
  try {
    const profile = await ProviderProfile.findById(req.params.id)
      .populate('user', 'name avatar');
    if (!profile) return res.status(404).json({ message: 'Provider not found' });

    // Access control: provider cannot view another provider profile.
    if (
      req.user &&
      req.user.activeRole === 'provider' &&
      profile.user &&
      profile.user._id.toString() !== req.user._id.toString()
    ) {
      return res.status(403).json({ message: 'Access denied for same-role profile view' });
    }

    const reviews = await Review.find({ provider: profile.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('recruiter', 'name');

    res.json({ profile, reviews });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Upload provider profile photo (Cloudinary)
// @route   POST /api/provider/profile/photo
const uploadProfilePhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let newUrl;
    try {
      // Upload must go to Cloudinary; fail if not configured or upload fails
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'servicehub/providers',
        public_id: `provider_${req.user._id}_${Date.now()}`,
      });
      newUrl = result.secure_url;
    } catch (cloudErr) {
      return res.status(500).json({ message: 'Cloudinary upload failed', error: cloudErr.message });
    }

    // Delete old Cloudinary file
    const profile = await ProviderProfile.findOne({ user: req.user._id });
    const oldFile = profile?.profilePhoto || profile?.photo;
    if (oldFile && oldFile.includes('cloudinary.com')) {
      await deleteFromCloudinary(oldFile);
    } else if (oldFile && oldFile.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', oldFile);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await ProviderProfile.findOneAndUpdate(
      { user: req.user._id },
      { profilePhoto: newUrl, photo: newUrl },
      { new: true }
    );
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: newUrl, avatar: newUrl });

    res.json({ url: newUrl });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete provider profile photo
// @route   DELETE /api/provider/profile/photo
const deleteProfilePhoto = async (req, res) => {
  try {
    const profile = await ProviderProfile.findOne({ user: req.user._id });
    const oldFile = profile?.profilePhoto || profile?.photo;
    if (oldFile && oldFile.includes('cloudinary.com')) {
      await deleteFromCloudinary(oldFile);
    } else if (oldFile && oldFile.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', oldFile);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await ProviderProfile.findOneAndUpdate({ user: req.user._id }, { profilePhoto: '', photo: '' });
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: '', avatar: '' });

    res.json({ message: 'Photo deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Upload document to Cloudinary
// @route   POST /api/provider/profile/document
const uploadDocument = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let url;
    try {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'servicehub/documents',
        resource_type: 'auto',
        public_id: `doc_${req.user._id}_${Date.now()}`,
      });
      url = result.secure_url;
    } catch (cloudErr) {
      return res.status(500).json({ message: 'Cloudinary upload failed', error: cloudErr.message });
    }

    const profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });
    profile.documents.push(url);
    await profile.save();

    res.json({ url, documents: profile.documents });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get provider visit history
// @route   GET /api/provider/history
const getMyHistory = async (req, res) => {
  try {
    const history = await VisitHistory.find({ visitedUser: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('user', 'name email avatar');
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getMyProfile,
  updateProfile,
  getDashboard,
  getPlans,
  purchasePlan,
  getMyLeads,
  updateLeadStatus,
  getPublicProfile,
  uploadProfilePhoto,
  deleteProfilePhoto,
  uploadDocument,
  getMyHistory,
};
