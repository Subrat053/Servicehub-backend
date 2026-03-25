const RecruiterProfile = require('../models/RecruiterProfile');
const ProviderProfile = require('../models/ProviderProfile');
const JobPost = require('../models/JobPost');
const Lead = require('../models/Lead');
const Payment = require('../models/Payment');
const Plan = require('../models/Plan');
const Review = require('../models/Review');
const RotationPool = require('../models/RotationPool');
const User = require('../models/User');
const VisitHistory = require('../models/VisitHistory');
const WhatsappLog = require('../models/WhatsappLog');
const Application = require('../models/Application');
const Notification = require('../models/Notification');
const { sendWhatsAppMessage } = require('../utils/messaging');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const { createNotification, notifyProvidersOfNewJob } = require('../services/notificationService');
const { getActiveSubscription } = require('../middleware/subscription');
const { assignPlanToUser, assignFreePlan } = require('./subscriptionController');
const { getCoordinatesFromText, upsertLocationRecord } = require('../services/locationService');
const {
  getProvidersByLocation,
  filterActiveSubscriptions,
  separateProviders,
  applyRotation,
  mergeFinalList,
} = require('../services/providerService');
const path = require('path');
const fs = require('fs');

const toCoordinate = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const ensureRecruiterMonthlyFreeQuota = async (profile) => {
  if (!profile) return;
  if (profile.currentPlan !== 'free') return;

  const now = new Date();
  const needsReset = !profile.freeUnlockResetAt || new Date(profile.freeUnlockResetAt).getTime() <= now.getTime();

  if (needsReset) {
    profile.unlocksRemaining = 2;
    profile.unlockPackSize = 2;
    profile.freeUnlockResetAt = new Date(now.getTime() + THIRTY_DAYS_MS);
    await profile.save();
  }
};

// @desc    Get recruiter dashboard
// @route   GET /api/recruiter/dashboard
const getDashboard = async (req, res) => {
  try {
    let profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!profile) {
      // Auto-create if missing (data-recovery for legacy accounts)
      profile = await RecruiterProfile.create({
        user: req.user._id,
        freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        freeUnlockResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        unlocksRemaining: 2,
        unlockPackSize: 2,
      });
    }

    await ensureRecruiterMonthlyFreeQuota(profile);

    const jobs = await JobPost.find({ recruiter: req.user._id }).sort({ createdAt: -1 }).limit(10);
    const recentUnlocks = await Lead.find({ recruiter: req.user._id, isUnlocked: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate({
        path: 'provider',
        select: 'name',
      });

    // Subscription data
    let { subscription, plan } = await getActiveSubscription(req.user._id, 'recruiter');
    if (!plan) {
      await assignFreePlan(req.user._id, 'recruiter');
      const refreshed = await getActiveSubscription(req.user._id, 'recruiter');
      subscription = refreshed.subscription;
      plan = refreshed.plan;
    }
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const jobsThisMonth = await JobPost.countDocuments({ recruiter: req.user._id, createdAt: { $gte: startOfMonth } });
    const totalApplicationsReceived = await Application.countDocuments({
      jobPost: { $in: jobs.map(j => j._id) },
    });

    const remainingPostLimit = plan
      ? (plan.jobPostLimit === -1 ? 'unlimited' : Math.max(0, plan.jobPostLimit - jobsThisMonth))
      : 0;

    res.json({
      profile,
      jobs,
      recentUnlocks,
      stats: {
        totalJobsPosted: profile.totalJobsPosted,
        totalApplicationsReceived,
        remainingPostLimit,
        subscriptionPlan: plan ? plan.name : 'None',
        totalUnlocks: profile.totalUnlocks,
        freeProfileViews: profile.freeProfileViews,
        unlocksRemaining: profile.unlocksRemaining,
        currentPlan: profile.currentPlan,
        planStatus: subscription?.status || 'inactive',
        planEndDate: subscription?.endDate || null,
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
    const {
      companyName, companyType, city, state, description, skillsNeeded,
      nearestLocation, latitude, longitude,
    } = req.body;
    let profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!profile) {
      profile = await RecruiterProfile.create({
        user: req.user._id,
        freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        freeUnlockResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        unlocksRemaining: 2,
        unlockPackSize: 2,
      });
    }

    if (companyName !== undefined) profile.companyName = companyName;
    if (companyType !== undefined) profile.companyType = companyType;
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
    if (description !== undefined) profile.description = description;
    if (Array.isArray(skillsNeeded)) profile.skillsNeeded = skillsNeeded;

    if (req.body.name) {
      await User.findByIdAndUpdate(req.user._id, { name: req.body.name });
    }

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
          type: 'recruiter',
        });
      }
    }

    res.json(profile);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Escape special regex characters in user input
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// @desc    Search providers
// @route   GET /api/recruiter/search?skill=&city=&rating=&experience=&verified=&page=&limit=
const searchProviders = async (req, res) => {
  try {
    const {
      skill,
      category,
      city,
      tier,
      rating,
      experience,
      verified,
      lat,
      lon,
      radius,
      page = 1,
      limit = 20,
    } = req.query;

    const skillTerm = String(skill || category || '').trim();
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit, 10) || 20);
    const featuredLimit = Math.max(1, parseInt(process.env.FEATURED_LIMIT || 5, 10));
    const rotationIntervalSec = Math.max(1, parseInt(process.env.ROTATION_INTERVAL_SEC || 60, 10));
    const radiusKm = Number.isFinite(Number(radius)) ? Number(radius) : Number(process.env.SEARCH_RADIUS_KM || 50);

    const hasLat = lat !== undefined;
    const hasLon = lon !== undefined;
    const latNum = hasLat ? Number(lat) : null;
    const lonNum = hasLon ? Number(lon) : null;

    if ((hasLat && !hasLon) || (!hasLat && hasLon)) {
      return res.status(400).json({ message: 'Both lat and lon are required for geo search.' });
    }
    if (hasLat && hasLon) {
      if (!Number.isFinite(latNum) || !Number.isFinite(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
        return res.status(400).json({ message: 'Invalid lat/lon values.' });
      }
    }

    const filter = {};
    // Skill: substring match (e.g. "Tutor" matches "Online tutor")
    if (skillTerm) filter.skills = { $regex: escapeRegex(skillTerm), $options: 'i' };
    if (city) {
      // City: prefix-tolerant regex – trims 1 trailing char to absorb typos like "Kolkataa" → "Kolkata"
      const cityQuery = city.trim();
      const cityPrefix = cityQuery.length > 4
        ? cityQuery.slice(0, cityQuery.length - 1)
        : cityQuery;
      filter.city = { $regex: '^' + escapeRegex(cityPrefix), $options: 'i' };
    }
    if (tier) filter.tier = tier;
    if (rating) filter.rating = { $gte: parseFloat(rating) };
    if (experience) filter.experience = { $regex: escapeRegex(experience), $options: 'i' };
    if (verified === 'true') filter.isVerified = true;
    filter.isApproved = true;

    const sortConfig = { boostWeight: -1, rating: -1, createdAt: -1 };
    let candidates = await ProviderProfile.find(filter)
      .populate('user', 'name avatar email')
      .sort(sortConfig)
      .lean();

    // 2-pass fallback: if skill+city combo returns 0, retry with skill only
    // (city may have a typo that prefix-regex couldn't absorb)
    if (candidates.length === 0 && skillTerm && city) {
      const skillOnlyFilter = { isApproved: true, skills: { $regex: escapeRegex(skillTerm), $options: 'i' } };
      if (tier) skillOnlyFilter.tier = tier;
      if (rating) skillOnlyFilter.rating = { $gte: parseFloat(rating) };
      if (experience) skillOnlyFilter.experience = { $regex: escapeRegex(experience), $options: 'i' };
      if (verified === 'true') skillOnlyFilter.isVerified = true;
      candidates = await ProviderProfile.find(skillOnlyFilter)
        .populate('user', 'name avatar email')
        .sort(sortConfig)
        .lean();
    }

    // Geo-aware filtering (optional; if lat/lon provided)
    if (hasLat && hasLon) {
      candidates = await getProvidersByLocation(latNum, lonNum, radiusKm, candidates);
    }

    const activeSubscriptionProviders = filterActiveSubscriptions(candidates);
    const { featuredProviders: activeFeatured } = separateProviders(activeSubscriptionProviders);
    const rotatedFeatured = applyRotation(activeFeatured, rotationIntervalSec, featuredLimit);
    const featuredIds = new Set(rotatedFeatured.map((provider) => provider._id?.toString()).filter(Boolean));

    const normalProviders = candidates.filter((provider) => !featuredIds.has(provider._id?.toString()));
    const combinedProviders = mergeFinalList(rotatedFeatured, normalProviders);

    const skip = (pageNum - 1) * limitNum;
    const featured = rotatedFeatured;
    const normal = normalProviders.slice(skip, skip + limitNum);
    const combined = combinedProviders.slice(skip, skip + limitNum);
    const total = combinedProviders.length;

    // Keep legacy rotation key for backward compatibility.
    const rotationProviders = featured;

    if (skillTerm || city) {
      await RotationPool.findOneAndUpdate(
        { skill: (skillTerm || 'any').toLowerCase(), city: (city || 'any').toLowerCase() },
        {
          $setOnInsert: {
            skill: (skillTerm || 'any').toLowerCase(),
            city: (city || 'any').toLowerCase(),
            maxPoolSize: featuredLimit,
            rotationInterval: rotationIntervalSec,
          },
          $set: { rotationInterval: rotationIntervalSec, maxPoolSize: featuredLimit },
        },
        { upsert: true, new: false }
      );
    }

    // Track recruiter free view + save search history
    if (req.user && req.user.activeRole === 'recruiter') {
      const recruiterProfile = await RecruiterProfile.findOne({ user: req.user._id });
      if (recruiterProfile) {
        recruiterProfile.freeProfileViews += 1;
        await recruiterProfile.save();
      }

      // Save search history
      if (skillTerm || city) {
        await VisitHistory.create({
          user: req.user._id,
          type: 'search',
          searchQuery: [skillTerm, city].filter(Boolean).join(' in '),
          searchCity: city || '',
          searchSkill: skillTerm || '',
        });
      }
    }

    res.json({
      rotation: rotationProviders,
      featured,
      normal,
      combined,
      providers: combined,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
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

    await ensureRecruiterMonthlyFreeQuota(recruiterProfile);

    const FREE_LIMIT = parseInt(process.env.FREE_PROFILE_VIEW_LIMIT || 10);
    const isUnlimited = ['business', 'enterprise'].includes(recruiterProfile.currentPlan);

    if (!isUnlimited && recruiterProfile.freeProfileViews >= FREE_LIMIT) {
      return res.status(403).json({
        message: 'Free profile view limit reached. Purchase a plan to continue.',
        limitReached: true,
        viewsUsed: recruiterProfile.freeProfileViews,
        limit: FREE_LIMIT,
      });
    }

    const provider = await ProviderProfile.findById(req.params.id)
      .populate('user', 'name avatar email phone whatsappNumber');
    if (!provider) return res.status(404).json({ message: 'Provider not found' });

    // Check if already unlocked
    const existingUnlock = await Lead.findOne({
      provider: provider.user._id,
      recruiter: req.user._id,
      type: 'contact_unlock',
      isUnlocked: true,
    });

    // Increment view count
    provider.profileViews += 1;
    await provider.save();

    if (!isUnlimited) {
      recruiterProfile.freeProfileViews += 1;
      await recruiterProfile.save();
    }

    // Save visit history
    await VisitHistory.create({
      user: req.user._id,
      visitedUser: provider.user._id,
      visitedProfile: provider._id,
      type: 'profile_view',
    });

    // Create a profile_view lead
    await Lead.create({
      provider: provider.user._id,
      recruiter: req.user._id,
      type: 'profile_view',
    });

    // Optional rate-limit: emit profile view notification at most once per recruiter/provider pair per 6 hours.
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentProfileViewedNotification = await Notification.findOne({
      userId: provider.user._id,
      type: 'PROFILE_VIEWED',
      'data.recruiterId': req.user._id,
      createdAt: { $gte: sixHoursAgo },
    }).lean();

    if (!recentProfileViewedNotification) {
      await createNotification({
        userId: provider.user._id,
        type: 'PROFILE_VIEWED',
        title: 'Profile Viewed',
        message: 'Your profile was viewed by a recruiter',
        data: {
          recruiterId: req.user._id,
          recruiterName: req.user.name,
          providerProfileId: provider._id,
        },
      });
    }

    provider.leadsReceived += 1;
    await provider.save();

    const reviews = await Review.find({ provider: provider.user._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('recruiter', 'name');

    // Hide contact info if not unlocked
    const contactInfo = existingUnlock ? {
      phone: provider.user.phone,
      email: provider.user.email,
      whatsappNumber: provider.user.whatsappNumber || provider.user.phone,
    } : null;

    res.json({
      provider,
      reviews,
      isUnlocked: !!existingUnlock,
      contactInfo,
      viewsRemaining: isUnlimited ? 'unlimited' : FREE_LIMIT - recruiterProfile.freeProfileViews,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Unlock provider contact (requires plan/credits or payment)
// @route   POST /api/recruiter/unlock/:providerId
const unlockContact = async (req, res) => {
  try {
    const recruiterProfile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!recruiterProfile) return res.status(404).json({ message: 'Profile not found' });

    const providerProfile = await ProviderProfile.findById(req.params.providerId)
      .populate('user', 'name email phone avatar whatsappNumber');
    if (!providerProfile) return res.status(404).json({ message: 'Provider not found' });

    // Check if already unlocked
    const existing = await Lead.findOne({
      provider: providerProfile.user._id,
      recruiter: req.user._id,
      type: 'contact_unlock',
      isUnlocked: true,
    });
    if (existing) {
      return res.json({
        message: 'Contact already unlocked',
        alreadyUnlocked: true,
        contact: {
          name: providerProfile.user.name,
          email: providerProfile.user.email,
          phone: providerProfile.user.phone,
          whatsappNumber: providerProfile.user.whatsappNumber || providerProfile.user.phone,
        },
      });
    }

    const isUnlimited = ['business', 'enterprise'].includes(recruiterProfile.currentPlan);

    if (!isUnlimited && recruiterProfile.unlocksRemaining <= 0) {
      return res.status(403).json({
        message: 'No unlock credits remaining. Purchase a plan to unlock contacts.',
        needsPurchase: true,
      });
    }

    // Create payment record for unlock
    const payment = await Payment.create({
      user: req.user._id,
      amount: 0,
      type: 'unlock_pack',
      status: 'completed',
      transactionId: `UNL_${Date.now()}`,
      metadata: { providerId: providerProfile._id.toString(), providerName: providerProfile.user.name },
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

    // Save visit history
    await VisitHistory.create({
      user: req.user._id,
      visitedUser: providerProfile.user._id,
      visitedProfile: providerProfile._id,
      type: 'contact_unlock',
    });

    // WhatsApp notification to provider
    const providerPhone = providerProfile.user.whatsappNumber || providerProfile.user.phone;
    if (providerProfile.whatsappAlerts && providerPhone) {
      try {
        await sendWhatsAppMessage(providerPhone, 'new_lead', {
          recruiterName: req.user.name,
        });
        // Log WhatsApp notification
        await WhatsappLog.create({
          user: providerProfile.user._id,
          phone: providerPhone,
          templateName: 'new_lead',
          message: `New contact unlock from ${req.user.name}`,
          status: 'sent',
          triggerEvent: 'contact_unlock',
          metadata: { recruiterId: req.user._id, leadId: lead._id },
        });
        lead.notifiedViaWhatsapp = true;
        await lead.save();
      } catch (whatsErr) {
        console.error('[WhatsApp notify error]', whatsErr.message);
      }
    }

    // In-app notifications to provider
    await createNotification({
      userId: providerProfile.user._id,
      type: 'CONTACT_UNLOCKED',
      title: 'Contact Unlocked',
      message: 'Your profile was unlocked by a recruiter',
      data: {
        recruiterId: req.user._id,
        recruiterName: req.user.name,
        leadId: lead._id,
      },
    });

    await createNotification({
      userId: providerProfile.user._id,
      type: 'NEW_LEAD',
      title: 'New Lead',
      message: 'You have a new lead',
      data: {
        recruiterId: req.user._id,
        recruiterName: req.user.name,
        leadId: lead._id,
        source: 'contact_unlock',
      },
    });

    res.json({
      message: 'Contact unlocked successfully',
      contact: {
        name: providerProfile.user.name,
        email: providerProfile.user.email,
        phone: providerProfile.user.phone,
        whatsappNumber: providerProfile.user.whatsappNumber || providerProfile.user.phone,
      },
      lead,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Post a job
// @route   POST /api/recruiter/jobs
// Note: checkPostLimit middleware validates subscription limits before this runs
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

    // Notify matched providers.
    await notifyProvidersOfNewJob(
      job,
      matchedProviders.map((p) => p.user?._id).filter(Boolean)
    );

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
    if (plan.type !== 'recruiter') {
      return res.status(400).json({ message: 'Invalid plan type for recruiter purchase' });
    }

    let profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (!profile) {
      profile = await RecruiterProfile.create({
        user: req.user._id,
        freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        freeUnlockResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        unlocksRemaining: 2,
        unlockPackSize: 2,
      });
    }

    if (profile.currentPlan) {
      const currentPlan = await Plan.findOne({ type: 'recruiter', slug: profile.currentPlan });
      const currentOrder = Number(currentPlan?.sortOrder || 0);
      const nextOrder = Number(plan.sortOrder || 0);
      if (nextOrder <= currentOrder) {
        return res.status(400).json({
          message: `Only upgrades are allowed. Your current plan is '${currentPlan?.name || profile.currentPlan}'. Please choose a higher plan.`,
        });
      }
    }

    const payment = await Payment.create({
      user: req.user._id,
      plan: plan._id,
      amount: plan.price,
      currency: plan.currency,
      type: 'plan_purchase',
      status: 'completed',
      transactionId: `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    });

    profile.currentPlan = plan.slug;
    profile.planExpiresAt = new Date(Date.now() + plan.duration * 24 * 60 * 60 * 1000);
    profile.unlocksRemaining += plan.unlockCredits || 0;
    profile.unlockPackSize = plan.unlockCredits || 0;
    await profile.save();

    // Create UserSubscription record and update badge
    await assignPlanToUser(req.user._id, 'recruiter', plan);

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

// @desc    Upload recruiter profile photo (Cloudinary)
// @route   POST /api/recruiter/profile/photo
const uploadProfilePhoto = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    let newUrl;
    try {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'servicehub/recruiters',
        public_id: `recruiter_${req.user._id}_${Date.now()}`,
      });
      newUrl = result.secure_url;
    } catch (cloudErr) {
      return res.status(500).json({ message: 'Cloudinary upload failed', error: cloudErr.message });
    }

    const profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (profile?.profilePhoto && profile.profilePhoto.includes('cloudinary.com')) {
      await deleteFromCloudinary(profile.profilePhoto);
    } else if (profile?.profilePhoto && profile.profilePhoto.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', profile.profilePhoto);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await RecruiterProfile.findOneAndUpdate(
      { user: req.user._id },
      { profilePhoto: newUrl },
      { new: true }
    );
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: newUrl, avatar: newUrl });

    res.json({ url: newUrl });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete recruiter profile photo
// @route   DELETE /api/recruiter/profile/photo
const deleteProfilePhoto = async (req, res) => {
  try {
    const profile = await RecruiterProfile.findOne({ user: req.user._id });
    if (profile?.profilePhoto && profile.profilePhoto.includes('cloudinary.com')) {
      await deleteFromCloudinary(profile.profilePhoto);
    } else if (profile?.profilePhoto && profile.profilePhoto.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '..', profile.profilePhoto);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    await RecruiterProfile.findOneAndUpdate({ user: req.user._id }, { profilePhoto: '' });
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: '', avatar: '' });

    res.json({ message: 'Photo deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get recruiter visit/search history
// @route   GET /api/recruiter/history
const getMyHistory = async (req, res) => {
  try {
    const history = await VisitHistory.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('visitedUser', 'name avatar')
      .populate('visitedProfile', 'skills city rating profilePhoto');
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Check if a provider contact is unlocked
// @route   GET /api/recruiter/unlock-status/:providerId
const checkUnlockStatus = async (req, res) => {
  try {
    const recruiterProfile = await RecruiterProfile.findOne({ user: req.user._id });
    if (recruiterProfile) {
      await ensureRecruiterMonthlyFreeQuota(recruiterProfile);
    }

    const provider = await ProviderProfile.findById(req.params.providerId).populate('user', '_id');
    if (!provider) return res.status(404).json({ message: 'Provider not found' });

    const existing = await Lead.findOne({
      provider: provider.user._id,
      recruiter: req.user._id,
      type: 'contact_unlock',
      isUnlocked: true,
    });

    res.json({ isUnlocked: !!existing });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
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
  deleteProfilePhoto,
  getMyHistory,
  checkUnlockStatus,
};
