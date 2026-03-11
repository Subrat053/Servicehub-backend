const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const {
  getAvailableJobs,
  applyToJob,
  getMyApplications,
  getJobApplications,
  updateApplicationStatus,
} = require('../controllers/jobController');
const { protect, authorize } = require('../middleware/auth');
const { checkApplyLimit, attachSubscription } = require('../middleware/subscription');

// Optional auth: attach req.user if token present, but don't block
const optionalAuth = async (req, res, next) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer')) {
    try {
      const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
      req.user = await User.findById(decoded.id).select('-password');
    } catch (_) {}
  }
  next();
};

// Provider: my applications (must come BEFORE the generic /:jobId routes)
router.get('/my-applications', protect, authorize('provider'), getMyApplications);

// Recruiter: view applications for a specific job
router.get('/:jobId/applications', protect, authorize('recruiter'), getJobApplications);

// Recruiter: update application status
router.put('/applications/:applicationId', protect, authorize('recruiter'), updateApplicationStatus);

// Browse jobs (public, but logged-in providers get applied status)
router.get('/', optionalAuth, attachSubscription, getAvailableJobs);

// Provider: apply to job (with subscription limit check)
router.post('/:jobId/apply', protect, authorize('provider'), checkApplyLimit, applyToJob);

module.exports = router;
