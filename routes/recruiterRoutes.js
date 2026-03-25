const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  getDashboard,
  updateProfile,
  searchProviders,
  viewProvider,
  unlockContact,
  postJob,
  getMyJobs,
  getPlans,
  purchasePlan,
  uploadProfilePhoto,
  deleteProfilePhoto,
  getMyHistory,
  checkUnlockStatus,
} = require('../controllers/recruiterController');
const { addReviewLegacy } = require('../controllers/reviewController');
const { protect, authorizeRoleFromActive } = require('../middleware/auth');
const { checkPostLimit } = require('../middleware/subscription');
const { ensureRecruiterApproved } = require('../middleware/recruiterApproval');
const upload = require('../middleware/upload');

// Optional auth: attach req.user when token is provided.
const optionalAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer')) {
    try {
      const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password +role');
      if (req.user) {
        const roles = Array.isArray(req.user.roles) ? [...req.user.roles] : [];
        if (req.user.role && !roles.includes(req.user.role)) roles.push(req.user.role);
        req.user.roles = roles;
        req.user.activeRole = req.user.activeRole || roles[0] || null;
      }
    } catch (_) {}
  }
  next();
};

router.get('/dashboard', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getDashboard);
router.put('/profile', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, updateProfile);
router.get('/public-search', optionalAuth, searchProviders);
router.get('/search', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, searchProviders);
router.get('/view-provider/:id', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, viewProvider);
router.post('/unlock/:providerId', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, unlockContact);
router.get('/unlock-status/:providerId', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, checkUnlockStatus);
router.post('/jobs', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, checkPostLimit, postJob);
router.get('/jobs', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getMyJobs);
router.get('/plans', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getPlans);
router.post('/plans/purchase', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, purchasePlan);
router.post('/review/:providerId', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, addReviewLegacy);
router.get('/history', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getMyHistory);
router.post('/profile/photo', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, upload.single('profilePhoto'), uploadProfilePhoto);
router.delete('/profile/photo', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, deleteProfilePhoto);

module.exports = router;
