const ProviderProfile = require('../models/ProviderProfile');
const User = require('../models/User');
const Lead = require('../models/Lead');
const RotationPool = require('../models/RotationPool');
const Payment = require('../models/Payment');
const Plan = require('../models/Plan');
const Review = require('../models/Review');
const path = require('path');

// @desc    Get provider profile (own)
// @route   GET /api/provider/profile
const getMyProfile = async (req, res) => {
  try {
    const profile = await ProviderProfile.findOne({ user: req.user._id }).populate('user', 'name email phone avatar');
    if (!profile) return res.status(404).json({ message: 'Profile not found' });
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
      whatsappAlerts,
    } = req.body;

    let profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    // Free skill limit check
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
    const profile = await ProviderProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    const leads = await Lead.find({ provider: req.user._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('recruiter', 'name email');

    const reviews = await Review.find({ provider: req.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('recruiter', 'name');

    res.json({
      profile,
      leads,
      reviews,
      stats: {
        profileViews: profile.profileViews,
        leadsReceived: profile.leadsReceived,
        contactsUnlocked: profile.contactsUnlocked,
        profileCompletion: profile.profileCompletion,
        currentPlan: profile.currentPlan,
        profileExpiresAt: profile.profileExpiresAt,
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
    const profile = await ProviderProfile.findOne({ user: req.user._id });
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

    const reviews = await Review.find({ provider: profile.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('recruiter', 'name');

    res.json({ profile, reviews });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Upload provider profile photo
// @route   POST /api/provider/profile/photo
const uploadProfilePhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  // Save to ProviderProfile
  const profile = await ProviderProfile.findOneAndUpdate(
    { user: req.user._id },
    { profilePhoto: url },
    { new: true }
  );
  // Also update User model
  await User.findByIdAndUpdate(req.user._id, { profilePhoto: url });
  res.json({ url });
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
};
