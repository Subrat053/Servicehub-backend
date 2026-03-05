const RecruiterProfile = require('../models/RecruiterProfile');
const ProviderProfile = require('../models/ProviderProfile');
const JobPost = require('../models/JobPost');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');
const Plan = require('../models/Plan');
const Review = require('../models/Review');
const RotationPool = require('../models/RotationPool');
const User = require('../models/User');
const { sendWhatsAppMessage } = require('../utils/messaging');
const path = require('path');

// @desc    Get recruiter dashboard
// @route   GET /api/recruiter/dashboard
const getDashboard = async (req, res) => {
  try {
    const profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    const jobs = await JobPost.find({ recruiter: req.user._id }).sort({ createdAt: -1 }).limit(10);
    const recentUnlocks = await Lead.find({ recruiter: req.user._id, isUnlocked: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: 'provider',
        select: 'name',
      });

    res.json({
      profile,
      jobs,
      recentUnlocks,
      stats: {
        totalJobsPosted: profile.totalJobsPosted,
        totalUnlocks: profile.totalUnlocks,
        freeProfileViews: profile.freeProfileViews,
        unlocksRemaining: profile.unlocksRemaining,
        currentPlan: profile.currentPlan,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update recruiter profile
// @route   PUT /api/recruiter/profile
const updateProfile = async (req, res) => {
  try {
    const { companyName, companyType, city, state, description, skillsNeeded } = req.body;
    const profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!profile) return res.status(404).json({ message: 'Profile not found' });

    if (companyName !== undefined) profile.companyName = companyName;
    if (companyType !== undefined) profile.companyType = companyType;
    if (city !== undefined) profile.city = city;
    if (state !== undefined) profile.state = state;
    if (description !== undefined) profile.description = description;
    if (Array.isArray(skillsNeeded)) profile.skillsNeeded = skillsNeeded;

    if (req.body.name) {
      await User.findByIdAndUpdate(req.user._id, { name: req.body.name });
    }

    await profile.save();
    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Search providers
// @route   GET /api/recruiter/search?skill=&city=&rating=&experience=&verified=&page=&limit=
const searchProviders = async (req, res) => {
  try {
    const { skill, city, tier, rating, experience, verified, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (skill) filter.skills = { $regex: skill, $options: 'i' };
    if (city) filter.city = { $regex: city, $options: 'i' };
    if (tier) filter.tier = tier;
    if (rating) filter.rating = { $gte: parseFloat(rating) };
    if (experience) filter.experience = { $regex: experience, $options: 'i' };
    if (verified === 'true') filter.isVerified = true;
    filter.isApproved = true;

    // Get rotation pool providers for top row
    let rotationProviders = [];
    if (skill && city) {
      const pool = await RotationPool.findOne({
        skill: skill.toLowerCase(),
        city: city.toLowerCase(),
      }).populate({
        path: 'providers.provider',
        populate: { path: 'user', select: 'name avatar' },
      });

      if (pool && pool.providers.length > 0) {
        // Round-robin rotation
        const sorted = [...pool.providers].sort((a, b) => new Date(a.lastShown) - new Date(b.lastShown));
        const now = new Date();
        rotationProviders = sorted.slice(0, pool.maxPoolSize)
          .filter(p => p.provider)
          .map(p => {
            p.lastShown = now;
            return p.provider;
          });

        pool.currentIndex = (pool.currentIndex + 1) % pool.providers.length;
        await pool.save();
      }
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get featured providers
    const featured = await ProviderProfile.find({
      ...filter,
      currentPlan: { $in: ['featured', 'pro'] },
    })
      .populate('user', 'name avatar email')
      .sort({ boostWeight: -1 })
      .limit(5);

    // Get normal providers
    const normal = await ProviderProfile.find(filter)
      .populate('user', 'name avatar email')
      .sort({ boostWeight: -1, rating: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await ProviderProfile.countDocuments(filter);

    // Track recruiter free view
    if (req.user && req.user.role === 'recruiter') {
      const recruiterProfile = await RecruiterProfile.findOne({ user: req.user._id });
      if (recruiterProfile) {
        recruiterProfile.freeProfileViews += 1;
        await recruiterProfile.save();
      }
    }

    res.json({
      rotation: rotationProviders,
      featured,
      providers: normal,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    View provider profile (with free limit check)
// @route   GET /api/recruiter/view-provider/:id
const viewProvider = async (req, res) => {
  try {
    const recruiterProfile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!recruiterProfile) return res.status(404).json({ message: 'Profile not found' });

    const FREE_LIMIT = parseInt(process.env.FREE_PROFILE_VIEW_LIMIT || 10);
    const isUnlimited = ['business', 'enterprise'].includes(recruiterProfile.currentPlan);

    if (!isUnlimited && recruiterProfile.freeProfileViews >= FREE_LIMIT) {
      return res.status(403).json({
        message: 'Free profile view limit reached. Purchase an unlock pack.',
        limitReached: true,
        viewsUsed: recruiterProfile.freeProfileViews,
        limit: FREE_LIMIT,
      });
    }

    const provider = await ProviderProfile.findById(req.params.id)
      .populate('user', 'name avatar email');
    if (!provider) return res.status(404).json({ message: 'Provider not found' });

    // Increment view count
    provider.profileViews += 1;
    await provider.save();

    if (!isUnlimited) {
      recruiterProfile.freeProfileViews += 1;
      await recruiterProfile.save();
    }

    const reviews = await Review.find({ provider: provider.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('recruiter', 'name');

    res.json({
      provider,
      reviews,
      viewsRemaining: isUnlimited ? 'unlimited' : FREE_LIMIT - recruiterProfile.freeProfileViews,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Unlock provider contact
// @route   POST /api/recruiter/unlock/:providerId
const unlockContact = async (req, res) => {
  try {
    const recruiterProfile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!recruiterProfile) return res.status(404).json({ message: 'Profile not found' });

    const isUnlimited = ['business', 'enterprise'].includes(recruiterProfile.currentPlan);

    if (!isUnlimited && recruiterProfile.unlocksRemaining <= 0) {
      return res.status(403).json({
        message: 'No unlock credits remaining. Purchase an unlock pack.',
        needsPurchase: true,
      });
    }

    const providerProfile = await ProviderProfile.findById(req.params.providerId)
      .populate('user', 'name email phone avatar');
    if (!providerProfile) return res.status(404).json({ message: 'Provider not found' });

    // Create payment record (simulated for unlock)
    const payment = await Payment.create({
      user: req.user._id,
      amount: 0,
      type: 'unlock_pack',
      status: 'completed',
      transactionId: `UNL_${Date.now()}`,
    });

    // Create lead
    const lead = await Lead.create({
      provider: providerProfile.user._id,
      recruiter: req.user._id,
      type: 'contact_unlock',
      isUnlocked: true,
      unlockPaymentId: payment.transactionId,
    });

    // Update stats
    providerProfile.contactsUnlocked += 1;
    providerProfile.leadsReceived += 1;
    await providerProfile.save();

    if (!isUnlimited) {
      recruiterProfile.unlocksRemaining -= 1;
    }
    recruiterProfile.totalUnlocks += 1;
    await recruiterProfile.save();

    // WhatsApp notification to provider
    if (providerProfile.whatsappAlerts && providerProfile.user.phone) {
      await sendWhatsAppMessage(providerProfile.user.phone, 'new_lead', {
        recruiterName: req.user.name,
      });
    }

    res.json({
      message: 'Contact unlocked successfully',
      contact: {
        name: providerProfile.user.name,
        email: providerProfile.user.email,
        phone: providerProfile.user.phone,
      },
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Post a job
// @route   POST /api/recruiter/jobs
const postJob = async (req, res) => {
  try {
    const { title, skill, city, budgetMin, budgetMax, budgetType, description, requirements } = req.body;

    if (!title || !skill || !city || !description) {
      return res.status(400).json({ message: 'Title, skill, city and description are required' });
    }

    const job = await JobPost.create({
      recruiter: req.user._id,
      title,
      skill,
      city,
      budgetMin: budgetMin || 0,
      budgetMax: budgetMax || 0,
      budgetType: budgetType || 'negotiable',
      description,
      requirements: requirements || [],
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    });

    // Update recruiter stats
    await RecruiterProfile.findOneAndUpdate(
      { user: req.user._id },
      { $inc: { totalJobsPosted: 1 } }
    );

    // Match providers and create leads
    const matchedProviders = await ProviderProfile.find({
      skills: { $regex: skill, $options: 'i' },
      city: { $regex: city, $options: 'i' },
      isApproved: true,
    }).populate('user', 'name phone');

    for (const provider of matchedProviders.slice(0, 20)) {
      await Lead.create({
        provider: provider.user._id,
        recruiter: req.user._id,
        jobPost: job._id,
        type: 'job_match',
      });

      if (provider.whatsappAlerts && provider.user.phone) {
        await sendWhatsAppMessage(provider.user.phone, 'new_job_match', {
          jobTitle: title,
          city,
        });
      }

      provider.leadsReceived += 1;
      await provider.save();
    }

    job.matchedProviders = matchedProviders.map(p => p._id);
    await job.save();

    res.status(201).json({ message: 'Job posted successfully', job, matchedCount: matchedProviders.length });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get my posted jobs
// @route   GET /api/recruiter/jobs
const getMyJobs = async (req, res) => {
  try {
    const jobs = await JobPost.find({ recruiter: req.user._id }).sort({ createdAt: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get recruiter plans
// @route   GET /api/recruiter/plans
const getPlans = async (req, res) => {
  try {
    const plans = await Plan.find({ type: 'recruiter', isActive: true }).sort({ sortOrder: 1 });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Purchase recruiter plan
// @route   POST /api/recruiter/plans/purchase
const purchasePlan = async (req, res) => {
  try {
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ message: 'Plan not found' });

    const payment = await Payment.create({
      user: req.user._id,
      plan: plan._id,
      amount: plan.price,
      currency: plan.currency,
      type: 'plan_purchase',
      status: 'completed',
      transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    const profile = await RecruiterProfile.findOne({ user: req.user._id });
    profile.currentPlan = plan.slug;
    profile.planExpiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
    profile.unlocksRemaining += plan.unlockCredits || 0;
    profile.unlockPackSize = plan.unlockCredits || 0;
    await profile.save();

    res.json({ message: 'Plan purchased successfully', payment, profile });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Add review for provider
// @route   POST /api/recruiter/review/:providerId
const addReview = async (req, res) => {
  try {
    const { rating, comment } = req.body;
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const providerProfile = await ProviderProfile.findById(req.params.providerId);
    if (!providerProfile) return res.status(404).json({ message: 'Provider not found' });

    const existing = await Review.findOne({
      provider: providerProfile.user,
      recruiter: req.user._id,
    });
    if (existing) return res.status(400).json({ message: 'You already reviewed this provider' });

    const review = await Review.create({
      provider: providerProfile.user,
      recruiter: req.user._id,
      rating,
      comment: comment || '',
    });

    // Update provider average rating
    const allReviews = await Review.find({ provider: providerProfile.user });
    const avgRating = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
    providerProfile.rating = Math.round(avgRating * 10) / 10;
    providerProfile.totalReviews = allReviews.length;
    await providerProfile.save();

    res.status(201).json(review);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Upload recruiter profile photo
// @route   POST /api/recruiter/profile/photo
const uploadProfilePhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  // Save to RecruiterProfile
  const profile = await RecruiterProfile.findOneAndUpdate(
    { user: req.user._id },
    { profilePhoto: url },
    { new: true }
  );
  // Also update User model
  await User.findByIdAndUpdate(req.user._id, { profilePhoto: url });
  res.json({ url });
};

module.exports = {
  getDashboard,
  updateProfile,
  searchProviders,
  viewProvider,
  unlockContact,
  postJob,
  getMyJobs,
  getPlans,
  purchasePlan,
  addReview,
  uploadProfilePhoto,
};
