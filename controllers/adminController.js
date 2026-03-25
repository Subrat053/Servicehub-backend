const User = require('../models/User');
const SkillCategory = require('../models/SkillCategory');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const JobPost = require('../models/JobPost');
const Lead = require('../models/Lead');
const Plan = require('../models/Plan');
const Payment = require('../models/Payment');
const AdminSetting = require('../models/AdminSetting');
const RotationPool = require('../models/RotationPool');
const WhatsappLog = require('../models/WhatsappLog');
const Review = require('../models/Review');
const VisitHistory = require('../models/VisitHistory');
const UserSubscription = require('../models/UserSubscription');
const ApprovalLog = require('../models/ApprovalLog');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utils/cloudinary');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PLAN_TIERS = new Set(['starter', 'business', 'enterprise']);
const LEGACY_PAID_TIERS = new Set(['basic', 'pro', 'featured']);
const PLAN_DURATIONS = [30, 90, 180, 365];
const DEFAULT_DISCOUNTS = { 90: 5, 180: 10, 365: 20 };

const roundMoney = (value) => Math.max(0, Math.round((Number(value) || 0) * 100) / 100);

const getPlanDiscounts = async () => {
  const keys = ['plan_discount_90', 'plan_discount_180', 'plan_discount_365'];
  const settings = await AdminSetting.find({ key: { $in: keys } }).lean();
  const byKey = new Map(settings.map((s) => [s.key, Number(s.value)]));

  return {
    90: Number.isFinite(byKey.get('plan_discount_90')) ? byKey.get('plan_discount_90') : DEFAULT_DISCOUNTS[90],
    180: Number.isFinite(byKey.get('plan_discount_180')) ? byKey.get('plan_discount_180') : DEFAULT_DISCOUNTS[180],
    365: Number.isFinite(byKey.get('plan_discount_365')) ? byKey.get('plan_discount_365') : DEFAULT_DISCOUNTS[365],
  };
};

const derivePriceFromMonthly = (monthlyPrice, duration, discountPercent) => {
  if (duration === 30) return roundMoney(monthlyPrice);
  const months = duration / 30;
  const discountedMultiplier = Math.max(0, 1 - (Number(discountPercent) || 0) / 100);
  return roundMoney(Number(monthlyPrice || 0) * months * discountedMultiplier);
};

const hasPrivilegedRole = (userLike) => {
  if (!userLike) return false;
  const roles = Array.isArray(userLike.roles) ? userLike.roles : [];
  const activeRole = userLike.activeRole || userLike.role;
  return roles.includes('admin') || roles.includes('manager') || activeRole === 'admin' || activeRole === 'manager';
};

const getExcludedModerationUserIds = async (actorId) => {
  const privilegedUsers = await User.find({
    $or: [
      { roles: { $in: ['admin', 'manager'] } },
      { activeRole: { $in: ['admin', 'manager'] } },
      { role: { $in: ['admin', 'manager'] } },
    ],
  }).select('_id');

  const ids = privilegedUsers.map((u) => u._id);
  if (actorId) ids.push(actorId);
  return ids;
};

const applyApprovalDecision = async ({ profileModel, profileId, approved, note, actor, targetType }) => {
  const profile = await profileModel.findById(profileId).populate('user', 'name email phone roles activeRole role');
  if (!profile) return null;

  if (!profile.user) {
    const error = new Error('Target user not found');
    error.statusCode = 404;
    throw error;
  }

  if (String(profile.user._id) === String(actor?._id)) {
    const error = new Error('You cannot approve or reject your own profile.');
    error.statusCode = 403;
    throw error;
  }

  if (hasPrivilegedRole(profile.user)) {
    const error = new Error('Admin/manager profiles are not eligible for approval actions.');
    error.statusCode = 400;
    throw error;
  }

  const isApproved = approved !== false;
  profile.isApproved = isApproved;
  profile.isVerified = isApproved;
  profile.approvalAction = isApproved ? 'approved' : 'rejected';
  profile.approvalNote = typeof note === 'string' ? note.trim() : '';
  profile.approvedBy = actor?._id || null;
  profile.approvedByRole = actor?.activeRole || actor?.role || null;
  profile.approvedAt = new Date();
  await profile.save();

  await ApprovalLog.create({
    targetType,
    targetProfileId: profile._id,
    targetUserId: profile.user?._id,
    targetName: profile.user?.name || '',
    action: isApproved ? 'approved' : 'rejected',
    note: profile.approvalNote,
    actorId: actor?._id,
    actorName: actor?.name || '',
    actorRole: actor?.activeRole || actor?.role || 'admin',
  });

  return profile;
};

const syncTierPlanFamily = async ({ payload, currentPlan }) => {
  const type = payload.type || currentPlan?.type;
  const slug = payload.slug || currentPlan?.slug;

  if (!type || !slug) {
    throw new Error('type and slug are required');
  }

  const isPaidTier = PLAN_TIERS.has(slug) && Number(payload.price) > 0;
  if (!isPaidTier) return null;

  const discounts = await getPlanDiscounts();

  let monthlyPrice;
  if (Number(payload.duration) === 30) {
    monthlyPrice = Number(payload.price);
  } else {
    const existingMonthly = await Plan.findOne({ type, slug, duration: 30 });
    if (existingMonthly) {
      monthlyPrice = Number(existingMonthly.price);
    } else {
      const currentDuration = Number(payload.duration) || 30;
      const discount = currentDuration === 30 ? 0 : (discounts[currentDuration] || 0);
      const multiplier = (currentDuration / 30) * (1 - discount / 100);
      monthlyPrice = multiplier > 0 ? Number(payload.price) / multiplier : Number(payload.price);
    }
  }

  const base = {
    ...payload,
    type,
    slug,
    name: payload.name || currentPlan?.name || slug,
    sortOrder: payload.sortOrder ?? currentPlan?.sortOrder ?? (slug === 'starter' ? 1 : slug === 'business' ? 2 : 3),
  };

  const upserts = [];
  for (const duration of PLAN_DURATIONS) {
    const discount = duration === 30 ? 0 : (discounts[duration] || 0);
    const price = derivePriceFromMonthly(monthlyPrice, duration, discount);

    const doc = await Plan.findOneAndUpdate(
      { type, slug, duration },
      {
        ...base,
        duration,
        price,
        isActive: base.isActive !== false,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
    upserts.push(doc);
  }

  return upserts;
};

// @desc    Admin dashboard stats
// @route   GET /api/admin/dashboard
const getDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      totalProviders,
      totalRecruiters,
      pendingRecruiterApprovals,
      totalJobs,
      totalLeads,
      totalPayments,
      recentUsers,
      revenueAgg,
      activeSubscriptions,
      monthlyRevenueAgg,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'provider' }),
      User.countDocuments({ role: 'recruiter' }),
      RecruiterProfile.countDocuments({ isApproved: false }),
      JobPost.countDocuments(),
      Lead.countDocuments(),
      Payment.countDocuments({ status: 'completed' }),
      User.find().sort({ createdAt: -1 }).limit(10).select('name email role createdAt'),
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      UserSubscription.countDocuments({ status: 'active', endDate: { $gt: new Date() } }),
      Payment.aggregate([
        { $match: { status: 'completed', createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      stats: {
        totalUsers,
        totalProviders,
        totalRecruiters,
        pendingRecruiterApprovals,
        totalJobs,
        totalLeads,
        totalPayments,
        totalRevenue: revenueAgg.length > 0 ? revenueAgg[0].total : 0,
        activeSubscriptions,
        monthlyRevenue: monthlyRevenueAgg.length > 0 ? monthlyRevenueAgg[0].total : 0,
      },
      recentUsers,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all users
// @route   GET /api/admin/users?role=&page=&limit=&search=
const getUsers = async (req, res) => {
  try {
    const { role, page = 1, limit = 20, search } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);
    res.json({ users, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Block/Unblock user
// @route   PUT /api/admin/users/:id/block
const toggleBlockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isBlocked = !user.isBlocked;
    await user.save();
    res.json({ message: `User ${user.isBlocked ? 'blocked' : 'unblocked'}`, user });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Approve/reject provider
// @route   PUT /api/admin/providers/:id/approve
const approveProvider = async (req, res) => {
  try {
    const { approved, note } = req.body;
    const profile = await applyApprovalDecision({
      profileModel: ProviderProfile,
      profileId: req.params.id,
      approved,
      note,
      actor: req.user,
      targetType: 'provider',
    });
    if (!profile) return res.status(404).json({ message: 'Provider not found' });
    res.json({ message: `Provider ${profile.isApproved ? 'approved' : 'rejected'}`, profile });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ message: error.message || 'Server error', error: error.message });
  }
};

// @desc    Approve/reject recruiter
// @route   PUT /api/admin/recruiters/:id/approve
const approveRecruiter = async (req, res) => {
  try {
    const { approved, note } = req.body;
    const profile = await applyApprovalDecision({
      profileModel: RecruiterProfile,
      profileId: req.params.id,
      approved,
      note,
      actor: req.user,
      targetType: 'recruiter',
    });
    if (!profile) return res.status(404).json({ message: 'Recruiter not found' });
    res.json({ message: `Recruiter ${profile.isApproved ? 'approved' : 'rejected'}`, profile });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({ message: error.message || 'Server error', error: error.message });
  }
};

// @desc    Create manager (admin only)
// @route   POST /api/admin/managers
const createManager = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!name || !normalizedEmail) {
      return res.status(400).json({ message: 'name and email are required' });
    }

    const existing = await User.findOne({ email: normalizedEmail }).select('+role');
    if (existing) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const generatedPassword = password || crypto.randomBytes(6).toString('base64url');

    const manager = await User.create({
      name,
      email: normalizedEmail,
      phone: phone || '',
      password: generatedPassword,
      roles: ['manager'],
      activeRole: 'manager',
      role: 'manager',
      authProvider: 'email',
      isEmailVerified: true,
      termsAccepted: true,
      locale: 'en',
      preferredLanguage: 'en',
      country: 'US',
      currency: 'USD',
    });

    res.status(201).json({
      message: 'Manager created successfully',
      manager: {
        _id: manager._id,
        name: manager.name,
        email: manager.email,
        phone: manager.phone,
        roles: manager.roles,
        activeRole: manager.activeRole,
        createdAt: manager.createdAt,
      },
      generatedPassword: password ? undefined : generatedPassword,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    List managers (admin only)
// @route   GET /api/admin/managers
const getManagers = async (req, res) => {
  try {
    const managers = await User.find({
      $or: [
        { activeRole: 'manager' },
        { role: 'manager' },
        { roles: 'manager' },
      ],
    })
      .select('name email phone isBlocked activeRole roles createdAt lastLogin')
      .sort({ createdAt: -1 });

    res.json({ managers });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete manager (admin only)
// @route   DELETE /api/admin/managers/:id
const deleteManager = async (req, res) => {
  try {
    if (String(req.user?._id) === String(req.params.id)) {
      return res.status(400).json({ message: 'Admin cannot remove own account' });
    }

    const manager = await User.findById(req.params.id).select('+role');
    if (!manager) return res.status(404).json({ message: 'Manager not found' });

    const roles = Array.isArray(manager.roles) ? manager.roles : [];
    const activeRole = manager.activeRole || manager.role;
    const isManager = roles.includes('manager') || activeRole === 'manager' || manager.role === 'manager';
    if (!isManager) {
      return res.status(400).json({ message: 'Target user is not a manager account' });
    }

    await User.findByIdAndDelete(manager._id);

    res.json({ message: 'Manager deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Approval audit log (admin only)
// @route   GET /api/admin/approval-logs
const getApprovalLogs = async (req, res) => {
  try {
    const { actorId, targetType, action, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (actorId) filter.actorId = actorId;
    if (targetType) filter.targetType = targetType;
    if (action) filter.action = action;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

    const [logs, total] = await Promise.all([
      ApprovalLog.find(filter)
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      ApprovalLog.countDocuments(filter),
    ]);

    res.json({
      logs,
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

// @desc    Get all providers (admin view)
// @route   GET /api/admin/providers
const getProviders = async (req, res) => {
  try {
    const { page = 1, limit = 20, approved, search } = req.query;
    const filter = {};
    const excludedUserIds = await getExcludedModerationUserIds(req.user?._id);
    filter.user = { $nin: excludedUserIds };

    if (approved === 'true') filter.isApproved = true;
    if (approved === 'false') filter.isApproved = false;
    if (search) {
      filter.$or = [
        { skills: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { headline: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const providers = await ProviderProfile.find(filter)
      .populate('user', 'name email phone')
      .populate('approvedBy', 'name email activeRole role')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await ProviderProfile.countDocuments(filter);
    res.json({ providers, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all recruiters (admin view)
// @route   GET /api/admin/recruiters
const getRecruiters = async (req, res) => {
  try {
    const { page = 1, limit = 20, approved, search } = req.query;
    const filter = {};
    const excludedUserIds = await getExcludedModerationUserIds(req.user?._id);
    filter.user = { $nin: excludedUserIds };

    if (approved === 'true') filter.isApproved = true;
    if (approved === 'false') filter.isApproved = false;
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { companyType: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
        { state: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const recruiters = await RecruiterProfile.find(filter)
      .populate('user', 'name email phone')
      .populate('approvedBy', 'name email activeRole role')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await RecruiterProfile.countDocuments(filter);
    res.json({ recruiters, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    CRUD Plans
// @route   GET /api/admin/plans
const getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ type: 1, duration: 1, sortOrder: 1 });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   POST /api/admin/plans
const createPlan = async (req, res) => {
  try {
    const payload = req.body || {};
    const slug = String(payload.slug || '').toLowerCase();
    const isPaidTier = PLAN_TIERS.has(slug) || LEGACY_PAID_TIERS.has(slug);

    if (isPaidTier && Number(payload.price) <= 0) {
      return res.status(400).json({ message: 'Paid plan price must be greater than 0' });
    }

    if (slug === 'free' && payload.type === 'provider') {
      payload.price = 0;
      payload.jobApplyLimit = 2;
      payload.sortOrder = 0;
    }
    if (slug === 'free' && payload.type === 'recruiter') {
      payload.price = 0;
      payload.unlockCredits = 2;
      payload.sortOrder = 0;
    }

    if (PLAN_TIERS.has(slug) && Number(payload.price) > 0) {
      const family = await syncTierPlanFamily({ payload });
      return res.status(201).json({
        message: 'Plan family synced from monthly price with discounts',
        plans: family,
      });
    }

    const plan = await Plan.create(payload);
    res.status(201).json(plan);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   PUT /api/admin/plans/:id
const updatePlan = async (req, res) => {
  try {
    const existing = await Plan.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'Plan not found' });

    const payload = { ...req.body, type: req.body.type || existing.type, slug: req.body.slug || existing.slug };
    const slug = String(payload.slug || '').toLowerCase();
    const effectivePrice = Number(payload.price ?? existing.price);
    const isPaidTier = PLAN_TIERS.has(slug) || LEGACY_PAID_TIERS.has(slug);

    if (isPaidTier && effectivePrice <= 0) {
      return res.status(400).json({ message: 'Paid plan price must be greater than 0' });
    }

    if (slug === 'free' && payload.type === 'provider') {
      payload.price = 0;
      payload.jobApplyLimit = 2;
      payload.sortOrder = 0;
    }
    if (slug === 'free' && payload.type === 'recruiter') {
      payload.price = 0;
      payload.unlockCredits = 2;
      payload.sortOrder = 0;
    }

    if (PLAN_TIERS.has(slug) && Number(payload.price || existing.price) > 0) {
      const family = await syncTierPlanFamily({ payload: { ...existing.toObject(), ...payload }, currentPlan: existing });
      return res.json({
        message: 'Plan family synced from monthly price with discounts',
        plans: family,
      });
    }

    const plan = await Plan.findByIdAndUpdate(req.params.id, payload, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ message: 'Plan not found' });
    res.json(plan);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   DELETE /api/admin/plans/:id
const deletePlan = async (req, res) => {
  try {
    await Plan.findByIdAndDelete(req.params.id);
    res.json({ message: 'Plan deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Admin settings CRUD
// @route   GET /api/admin/settings
const getSettings = async (req, res) => {
  try {
    const settings = await AdminSetting.find().sort({ category: 1 });
    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   PUT /api/admin/settings
const updateSettings = async (req, res) => {
  try {
    const { settings } = req.body; // array of { key, value, description, category }
    for (const s of settings) {
      await AdminSetting.findOneAndUpdate(
        { key: s.key },
        { value: s.value, description: s.description, category: s.category },
        { upsert: true, new: true }
      );
    }
    res.json({ message: 'Settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get terms, privacy, or faq content
// @route   GET /api/admin/content/:type
const getContent = async (req, res) => {
  try {
    const { type } = req.params; // terms, privacy, faq
    const setting = await AdminSetting.findOne({ category: type });
    res.json(setting ? setting.value : '');
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update terms, privacy, or faq content
// @route   PUT /api/admin/content/:type
const updateContent = async (req, res) => {
  try {
    const { type } = req.params;
    const { value } = req.body;
    await AdminSetting.findOneAndUpdate(
      { category: type },
      { value },
      { upsert: true, new: true }
    );
    res.json({ message: `${type} updated` });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Rotation pool management
// @route   GET /api/admin/rotation-pools
const getRotationPools = async (req, res) => {
  try {
    const pools = await RotationPool.find()
      .populate({
        path: 'providers.provider',
        populate: { path: 'user', select: 'name' },
      });
    res.json(pools);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   PUT /api/admin/rotation-pools/:id
const updateRotationPool = async (req, res) => {
  try {
    const pool = await RotationPool.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(pool);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all payments
// @route   GET /api/admin/payments
const getPayments = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const payments = await Payment.find()
      .populate('user', 'name email')
      .populate('plan', 'name price')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    const total = await Payment.countDocuments();
    res.json({ payments, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get all jobs (admin)
// @route   GET /api/admin/jobs
const getAllJobs = async (req, res) => {
  try {
    const jobs = await JobPost.find()
      .populate('recruiter', 'name email')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Upload admin profile photo (Cloudinary)
// @route   POST /api/admin/profile/photo
const uploadProfilePhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  try {
    let url;
    try {
      const result = await uploadToCloudinary(req.file.buffer, {
        folder: 'servicehub/admin',
        public_id: `admin_${req.user._id}_${Date.now()}`,
      });
      url = result.secure_url;
    } catch (cloudErr) {
      return res.status(500).json({ message: 'Cloudinary upload failed', error: cloudErr.message });
    }
    await User.findByIdAndUpdate(req.user._id, { profilePhoto: url, avatar: url });
    res.json({ url });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getProfilePhoto = async (req, res) => {
  const admin = await User.findById(req.user._id);
  if (!admin) return res.status(404).json({ message: 'Admin not found' });
  res.json({
    _id: admin._id,
    name: admin.name,
    email: admin.email,
    profilePhoto: admin.profilePhoto || '',
  });
};

// @desc    Get payment gateway settings
// @route   GET /api/admin/payment-settings
const getPaymentSettings = async (req, res) => {
  try {
    const settings = await AdminSetting.find({ category: 'payment' });
    const config = {};
    settings.forEach(s => {
      // Mask secret keys for display (show last 4 chars only)
      if (s.key === 'stripe_secret_key' || s.key === 'stripe_webhook_secret') {
        config[s.key] = s.value ? '••••••••' + String(s.value).slice(-4) : '';
      } else {
        config[s.key] = s.value;
      }
    });
    res.json({
      stripe_publishable_key: config.stripe_publishable_key || '',
      stripe_secret_key: config.stripe_secret_key || '',
      stripe_webhook_secret: config.stripe_webhook_secret || '',
      stripe_simulation_mode: config.stripe_simulation_mode || false,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update payment gateway settings
// @route   PUT /api/admin/payment-settings
const updatePaymentSettings = async (req, res) => {
  try {
    const { stripe_publishable_key, stripe_secret_key, stripe_webhook_secret, stripe_simulation_mode } = req.body;

    const updates = [
      { key: 'stripe_publishable_key', value: stripe_publishable_key, description: 'Stripe Publishable Key' },
      { key: 'stripe_simulation_mode', value: stripe_simulation_mode === true || stripe_simulation_mode === 'true', description: 'Enable payment simulation mode' },
    ];

    // Only update secrets if they are not masked placeholder values
    if (stripe_secret_key && !stripe_secret_key.startsWith('••')) {
      updates.push({ key: 'stripe_secret_key', value: stripe_secret_key, description: 'Stripe Secret Key' });
    }
    if (stripe_webhook_secret && !stripe_webhook_secret.startsWith('••')) {
      updates.push({ key: 'stripe_webhook_secret', value: stripe_webhook_secret, description: 'Stripe Webhook Secret' });
    }

    for (const item of updates) {
      await AdminSetting.findOneAndUpdate(
        { key: item.key },
        { value: item.value, description: item.description, category: 'payment' },
        { upsert: true, new: true }
      );
    }

    res.json({ message: 'Payment settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete user (permanent deletion)
// @route   DELETE /api/admin/users/:id
const deleteUser = async (req, res) => {
  try {
    if (req.user && req.user._id && req.user._id.toString() === req.params.id.toString()) {
      return res.status(400).json({ message: 'Admin cannot remove own account' });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const userRoles = Array.isArray(user.roles) ? user.roles : [];
    const effectiveRole = user.activeRole || user.role || userRoles[0];
    
    // Delete associated profiles
    if (effectiveRole === 'provider') {
      await ProviderProfile.findOneAndDelete({ user: user._id });
      await Lead.deleteMany({ provider: user._id });
      await Review.deleteMany({
        $or: [
          { provider: user._id },
          { revieweeId: user._id },
          { reviewerId: user._id },
        ],
      });
    } else if (effectiveRole === 'recruiter') {
      await RecruiterProfile.findOneAndDelete({ user: user._id });
      await JobPost.deleteMany({ recruiter: user._id });
      await Lead.deleteMany({ recruiter: user._id });
      await Review.deleteMany({
        $or: [
          { recruiter: user._id },
          { revieweeId: user._id },
          { reviewerId: user._id },
        ],
      });
    }
    
    // Delete user
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete provider profile
// @route   DELETE /api/admin/providers/:id
const deleteProvider = async (req, res) => {
  try {
    const profile = await ProviderProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Provider not found' });
    
    // Delete associated data
    await Lead.deleteMany({ provider: profile.user });
    await Review.deleteMany({
      $or: [
        { provider: profile.user },
        { revieweeId: profile.user },
        { reviewerId: profile.user },
      ],
    });
    await RotationPool.updateMany(
      { providers: profile._id },
      { $pull: { providers: profile._id } }
    );
    
    // Delete provider profile
    await ProviderProfile.findByIdAndDelete(req.params.id);
    
    // Delete user account
    await User.findByIdAndDelete(profile.user);
    
    res.json({ message: 'Provider deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Delete recruiter profile
// @route   DELETE /api/admin/recruiters/:id
const deleteRecruiter = async (req, res) => {
  try {
    const profile = await RecruiterProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Recruiter not found' });

    await JobPost.deleteMany({ recruiter: profile.user });
    await Lead.deleteMany({ recruiter: profile.user });
    await Review.deleteMany({
      $or: [
        { recruiter: profile.user },
        { revieweeId: profile.user },
        { reviewerId: profile.user },
      ],
    });

    await RecruiterProfile.findByIdAndDelete(req.params.id);
    await User.findByIdAndDelete(profile.user);

    res.json({ message: 'Recruiter deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Skill Categories ─────────────────────────────────────────────────────────

// @desc  GET all skill categories (public)
// @route GET /api/admin/skills  (admin)  |  GET /api/skills (public route added in server.js)
const getSkillCategories = async (req, res) => {
  try {
    const cats = await SkillCategory.find({ isActive: true }).sort({ tier: 1, sortOrder: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// @desc  CREATE a new skill category
// @route POST /api/admin/skills
const createSkillCategory = async (req, res) => {
  try {
    const cat = await SkillCategory.create(req.body);
    res.status(201).json(cat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc  UPDATE a skill category (name, icon, skills, sortOrder, isActive)
// @route PUT /api/admin/skills/:id
const updateSkillCategory = async (req, res) => {
  try {
    const cat = await SkillCategory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json(cat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc  ADD a skill to a category
// @route POST /api/admin/skills/:id/skills
const addSkillToCategory = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'name required' });
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const cat = await SkillCategory.findByIdAndUpdate(
      req.params.id,
      { $push: { skills: { name, slug, isActive: true } } },
      { new: true }
    );
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json(cat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc  REMOVE a skill from a category
// @route DELETE /api/admin/skills/:id/skills/:skillId
const removeSkillFromCategory = async (req, res) => {
  try {
    const cat = await SkillCategory.findByIdAndUpdate(
      req.params.id,
      { $pull: { skills: { _id: req.params.skillId } } },
      { new: true }
    );
    if (!cat) return res.status(404).json({ message: 'Category not found' });
    res.json(cat);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// @desc  DELETE a skill category
// @route DELETE /api/admin/skills/:id
const deleteSkillCategory = async (req, res) => {
  try {
    await SkillCategory.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// ─── User Detail View (admin sees everything) ──────────────────────────────────

// @desc    Get detailed user profile (admin can see any user)
// @route   GET /api/admin/users/:id
const getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    let profile = null;
    let leads = [];
    let history = [];
    let payments = [];

    if (user.role === 'provider') {
      profile = await ProviderProfile.findOne({ user: user._id });
      leads = await Lead.find({ provider: user._id }).sort({ createdAt: -1 }).limit(20).populate('recruiter', 'name email');
    } else if (user.role === 'recruiter') {
      profile = await RecruiterProfile.findOne({ user: user._id });
      leads = await Lead.find({ recruiter: user._id }).sort({ createdAt: -1 }).limit(20).populate('provider', 'name email');
    }

    history = await VisitHistory.find({ user: user._id }).sort({ createdAt: -1 }).limit(30);
    payments = await Payment.find({ user: user._id }).sort({ createdAt: -1 }).limit(20).populate('plan', 'name price');

    res.json({ user, profile, leads, history, payments });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Currency Settings ─────────────────────────────────────────────────────────

// @desc    Get currency configuration
// @route   GET /api/admin/currency-settings
const getCurrencySettings = async (req, res) => {
  try {
    const settings = await AdminSetting.find({ category: 'currency' });
    const config = {};
    settings.forEach(s => { config[s.key] = s.value; });
    res.json({
      default_currency_IN: config.default_currency_IN || 'INR',
      default_currency_AE: config.default_currency_AE || 'AED',
      exchange_rate_INR_AED: config.exchange_rate_INR_AED || 0.044,
      exchange_rate_INR_USD: config.exchange_rate_INR_USD || 0.012,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update currency configuration
// @route   PUT /api/admin/currency-settings
const updateCurrencySettings = async (req, res) => {
  try {
    const { default_currency_IN, default_currency_AE, exchange_rate_INR_AED, exchange_rate_INR_USD } = req.body;
    const updates = [
      { key: 'default_currency_IN', value: default_currency_IN || 'INR', description: 'Default currency for India' },
      { key: 'default_currency_AE', value: default_currency_AE || 'AED', description: 'Default currency for UAE' },
      { key: 'exchange_rate_INR_AED', value: parseFloat(exchange_rate_INR_AED) || 0.044, description: 'INR to AED exchange rate' },
      { key: 'exchange_rate_INR_USD', value: parseFloat(exchange_rate_INR_USD) || 0.012, description: 'INR to USD exchange rate' },
    ];
    for (const item of updates) {
      await AdminSetting.findOneAndUpdate(
        { key: item.key },
        { value: item.value, description: item.description, category: 'currency' },
        { upsert: true, new: true }
      );
    }
    res.json({ message: 'Currency settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── Cloudinary Settings ────────────────────────────────────────────────────────

// @desc    Get Cloudinary configuration
// @route   GET /api/admin/cloudinary-settings
const getCloudinarySettings = async (req, res) => {
  try {
    const settings = await AdminSetting.find({ category: 'cloudinary' });
    const config = {};
    settings.forEach(s => {
      if (s.key === 'cloudinary_api_secret') {
        config[s.key] = s.value ? '••••••••' + String(s.value).slice(-4) : '';
      } else {
        config[s.key] = s.value;
      }
    });
    res.json({
      cloudinary_cloud_name: config.cloudinary_cloud_name || '',
      cloudinary_api_key: config.cloudinary_api_key || '',
      cloudinary_api_secret: config.cloudinary_api_secret || '',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update Cloudinary configuration
// @route   PUT /api/admin/cloudinary-settings
const updateCloudinarySettings = async (req, res) => {
  try {
    const { cloudinary_cloud_name, cloudinary_api_key, cloudinary_api_secret } = req.body;
    const updates = [
      { key: 'cloudinary_cloud_name', value: cloudinary_cloud_name, description: 'Cloudinary Cloud Name' },
      { key: 'cloudinary_api_key', value: cloudinary_api_key, description: 'Cloudinary API Key' },
    ];
    if (cloudinary_api_secret && !cloudinary_api_secret.startsWith('••')) {
      updates.push({ key: 'cloudinary_api_secret', value: cloudinary_api_secret, description: 'Cloudinary API Secret' });
    }
    for (const item of updates) {
      await AdminSetting.findOneAndUpdate(
        { key: item.key },
        { value: item.value, description: item.description, category: 'cloudinary' },
        { upsert: true, new: true }
      );
    }
    res.json({ message: 'Cloudinary settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── WhatsApp Logs ──────────────────────────────────────────────────────────────

// @desc    Get WhatsApp logs
// @route   GET /api/admin/whatsapp-logs
const getWhatsappLogs = async (req, res) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const logs = await WhatsappLog.find()
      .populate('user', 'name email phone')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));
    const total = await WhatsappLog.countDocuments();
    res.json({ logs, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ─── WhatsApp Settings ─────────────────────────────────────────────────────────

// @desc    Get WhatsApp configuration
// @route   GET /api/admin/whatsapp-settings
const getWhatsappSettings = async (req, res) => {
  try {
    const settings = await AdminSetting.find({ category: 'whatsapp' });
    const config = {};
    settings.forEach(s => {
      if (s.key === 'whatsapp_access_token') {
        config[s.key] = s.value ? '••••••••' + String(s.value).slice(-4) : '';
      } else {
        config[s.key] = s.value;
      }
    });
    res.json({
      whatsapp_phone_number_id: config.whatsapp_phone_number_id || '',
      whatsapp_access_token: config.whatsapp_access_token || '',
      whatsapp_dev_mode: config.whatsapp_dev_mode || false,
      whatsapp_otp_template: config.whatsapp_otp_template || '',
      whatsapp_welcome_template: config.whatsapp_welcome_template || '',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update WhatsApp configuration
// @route   PUT /api/admin/whatsapp-settings
const updateWhatsappSettings = async (req, res) => {
  try {
    const { whatsapp_phone_number_id, whatsapp_access_token, whatsapp_dev_mode, whatsapp_otp_template, whatsapp_welcome_template } = req.body;
    const updates = [
      { key: 'whatsapp_phone_number_id', value: whatsapp_phone_number_id, description: 'WhatsApp Phone Number ID' },
      { key: 'whatsapp_dev_mode', value: whatsapp_dev_mode === true || whatsapp_dev_mode === 'true', description: 'WhatsApp dev mode' },
      { key: 'whatsapp_otp_template', value: whatsapp_otp_template || '', description: 'WhatsApp OTP template name' },
      { key: 'whatsapp_welcome_template', value: whatsapp_welcome_template || '', description: 'WhatsApp welcome template' },
    ];
    if (whatsapp_access_token && !whatsapp_access_token.startsWith('••')) {
      updates.push({ key: 'whatsapp_access_token', value: whatsapp_access_token, description: 'WhatsApp Access Token' });
    }
    for (const item of updates) {
      await AdminSetting.findOneAndUpdate(
        { key: item.key },
        { value: item.value, description: item.description, category: 'whatsapp' },
        { upsert: true, new: true }
      );
    }
    res.json({ message: 'WhatsApp settings updated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getDashboard,
  getUsers,
  getUserDetail,
  toggleBlockUser,
  createManager,
  getManagers,
  deleteManager,
  getApprovalLogs,
  approveProvider,
  approveRecruiter,
  getProviders,
  getRecruiters,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getSettings,
  updateSettings,
  getRotationPools,
  updateRotationPool,
  getPayments,
  getAllJobs,
  getContent,
  updateContent,
  uploadProfilePhoto,
  getProfilePhoto,
  deleteUser,
  deleteProvider,
  deleteRecruiter,
  getPaymentSettings,
  updatePaymentSettings,
  getCurrencySettings,
  updateCurrencySettings,
  getCloudinarySettings,
  updateCloudinarySettings,
  getWhatsappLogs,
  getWhatsappSettings,
  updateWhatsappSettings,
  getSkillCategories,
  createSkillCategory,
  updateSkillCategory,
  addSkillToCategory,
  removeSkillFromCategory,
  deleteSkillCategory,
};
