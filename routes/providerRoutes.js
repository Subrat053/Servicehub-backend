const express = require('express');
const router = express.Router();
const {
  getMyProfile,
  updateProfile,
  getDashboard,
  getPlans,
  purchasePlan,
  getMyLeads,
  updateLeadStatus,
  getPublicProfile,
} = require('../controllers/providerController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/profile', protect, authorize('provider'), getMyProfile);
router.put('/profile', protect, authorize('provider'), updateProfile);
router.get('/dashboard', protect, authorize('provider'), getDashboard);
router.get('/plans', protect, authorize('provider'), getPlans);
router.post('/plans/purchase', protect, authorize('provider'), purchasePlan);
router.get('/leads', protect, authorize('provider'), getMyLeads);
router.put('/leads/:id', protect, authorize('provider'), updateLeadStatus);
router.get('/public/:id', getPublicProfile);
router.post('/profile/photo', protect, authorize('provider'), upload.single('profilePhoto'), require('../controllers/providerController').uploadProfilePhoto);

module.exports = router;
