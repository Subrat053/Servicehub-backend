const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
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
} = require('../controllers/providerController');
const { protect, authorizeRoleFromActive } = require('../middleware/auth');
const { ensureProviderApproved } = require('../middleware/providerApproval');
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

router.get('/profile', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, getMyProfile);
router.put('/profile', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, updateProfile);
router.get('/dashboard', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, getDashboard);
router.get('/plans', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, getPlans);
router.post('/plans/purchase', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, purchasePlan);
router.get('/leads', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, getMyLeads);
router.put('/leads/:id', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, updateLeadStatus);
router.get('/history', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, getMyHistory);
router.get('/public/:id', optionalAuth, getPublicProfile);
router.post('/profile/photo', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, upload.single('profilePhoto'), uploadProfilePhoto);
router.delete('/profile/photo', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, deleteProfilePhoto);
router.post('/profile/document', protect, authorizeRoleFromActive('provider'), ensureProviderApproved, upload.single('document'), uploadDocument);

module.exports = router;
