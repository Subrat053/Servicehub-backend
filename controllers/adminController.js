const User = require('../models/User');
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
const path = require('path');

// @desc    Admin dashboard stats
// @route   GET /api/admin/dashboard
const getDashboard = async (req, res) => {
  try {
    const [
      totalUsers,
      totalProviders,
      totalRecruiters,
      totalJobs,
      totalLeads,
      totalPayments,
      recentUsers,
      revenueAgg,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'provider' }),
      User.countDocuments({ role: 'recruiter' }),
      JobPost.countDocuments(),
      Lead.countDocuments(),
      Payment.countDocuments({ status: 'completed' }),
      User.find().sort({ createdAt: -1 }).limit(10).select('name email role createdAt'),
      Payment.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
    ]);

    res.json({
      stats: {
        totalUsers,
        totalProviders,
        totalRecruiters,
        totalJobs,
        totalLeads,
        totalPayments,
        totalRevenue: revenueAgg.length > 0 ? revenueAgg[0].total : 0,
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
    const { approved } = req.body;
    const profile = await ProviderProfile.findById(req.params.id);
    if (!profile) return res.status(404).json({ message: 'Provider not found' });
    profile.isApproved = approved !== false;
    profile.isVerified = approved !== false;
    await profile.save();
    res.json({ message: `Provider ${profile.isApproved ? 'approved' : 'rejected'}`, profile });
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
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await ProviderProfile.countDocuments(filter);
    res.json({ providers, pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) } });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    CRUD Plans
// @route   GET /api/admin/plans
const getAllPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ type: 1, sortOrder: 1 });
    res.json(plans);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   POST /api/admin/plans
const createPlan = async (req, res) => {
  try {
    const plan = await Plan.create(req.body);
    res.status(201).json(plan);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @route   PUT /api/admin/plans/:id
const updatePlan = async (req, res) => {
  try {
    const plan = await Plan.findByIdAndUpdate(req.params.id, req.body, { new: true });
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

// @desc    Upload admin profile photo
// @route   POST /api/admin/profile/photo
const uploadProfilePhoto = async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
  const url = `/uploads/${req.file.filename}`;
  // Save to User model (admin)
  await User.findByIdAndUpdate(req.user._id, { profilePhoto: url });
  res.json({ url });
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
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Delete associated profiles
    if (user.role === 'provider') {
      await ProviderProfile.findOneAndDelete({ user: user._id });
      await Lead.deleteMany({ provider: user._id });
      await Review.deleteMany({ provider: user._id });
    } else if (user.role === 'recruiter') {
      await RecruiterProfile.findOneAndDelete({ user: user._id });
      await JobPost.deleteMany({ recruiter: user._id });
      await Lead.deleteMany({ recruiter: user._id });
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
    await Review.deleteMany({ provider: profile.user });
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

module.exports = {
  getDashboard,
  getUsers,
  toggleBlockUser,
  approveProvider,
  getProviders,
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
  deleteUser,
  deleteProvider,
  getPaymentSettings,
  updatePaymentSettings,
};
