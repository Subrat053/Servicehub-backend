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

router.get('/dashboard', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getDashboard);
router.put('/profile', protect, authorizeRoleFromActive('recruiter'), updateProfile);
router.get('/search', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, searchProviders);
router.get('/view-provider/:id', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, viewProvider);
router.post('/unlock/:providerId', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, unlockContact);
router.get('/unlock-status/:providerId', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, checkUnlockStatus);
router.post('/jobs', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, checkPostLimit, postJob);
router.get('/jobs', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getMyJobs);
router.get('/plans', protect, authorizeRoleFromActive('recruiter'), getPlans);
router.post('/plans/purchase', protect, authorizeRoleFromActive('recruiter'), purchasePlan);
router.post('/review/:providerId', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, addReviewLegacy);
router.get('/history', protect, authorizeRoleFromActive('recruiter'), ensureRecruiterApproved, getMyHistory);
router.post('/profile/photo', protect, authorizeRoleFromActive('recruiter'), upload.single('profilePhoto'), uploadProfilePhoto);
router.delete('/profile/photo', protect, authorizeRoleFromActive('recruiter'), deleteProfilePhoto);

module.exports = router;
