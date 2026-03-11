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
  uploadProfilePhoto,
  deleteProfilePhoto,
  getMyHistory,
  checkUnlockStatus,
} = require('../controllers/recruiterController');
const { protect, authorize } = require('../middleware/auth');
const { checkPostLimit } = require('../middleware/subscription');
const upload = require('../middleware/upload');

router.get('/dashboard', protect, authorize('recruiter'), getDashboard);
router.put('/profile', protect, authorize('recruiter'), updateProfile);
router.get('/search', searchProviders);
router.get('/view-provider/:id', protect, authorize('recruiter'), viewProvider);
router.post('/unlock/:providerId', protect, authorize('recruiter'), unlockContact);
router.get('/unlock-status/:providerId', protect, authorize('recruiter'), checkUnlockStatus);
router.post('/jobs', protect, authorize('recruiter'), checkPostLimit, postJob);
router.get('/jobs', protect, authorize('recruiter'), getMyJobs);
router.get('/plans', protect, authorize('recruiter'), getPlans);
router.post('/plans/purchase', protect, authorize('recruiter'), purchasePlan);
router.post('/review/:providerId', protect, authorize('recruiter'), addReview);
router.get('/history', protect, authorize('recruiter'), getMyHistory);
router.post('/profile/photo', protect, authorize('recruiter'), upload.single('profilePhoto'), uploadProfilePhoto);
router.delete('/profile/photo', protect, authorize('recruiter'), deleteProfilePhoto);

module.exports = router;
