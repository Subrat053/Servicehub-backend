const express = require('express');
const router = express.Router();
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
  addReview,
} = require('../controllers/recruiterController');
const { protect, authorize } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.get('/dashboard', protect, authorize('recruiter'), getDashboard);
router.put('/profile', protect, authorize('recruiter'), updateProfile);
router.get('/search', searchProviders);
router.get('/view-provider/:id', protect, authorize('recruiter'), viewProvider);
router.post('/unlock/:providerId', protect, authorize('recruiter'), unlockContact);
router.post('/jobs', protect, authorize('recruiter'), postJob);
router.get('/jobs', protect, authorize('recruiter'), getMyJobs);
router.get('/plans', protect, authorize('recruiter'), getPlans);
router.post('/plans/purchase', protect, authorize('recruiter'), purchasePlan);
router.post('/review/:providerId', protect, authorize('recruiter'), addReview);
router.post('/profile/photo', protect, authorize('recruiter'), upload.single('profilePhoto'), require('../controllers/recruiterController').uploadProfilePhoto);

module.exports = router;
