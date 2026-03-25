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
const { protect, authorizeRoleFromActive } = require('../middleware/auth');
const { checkApplyLimit, attachSubscription } = require('../middleware/subscription');

// Optional auth: attach req.user if token present, but don't block
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

// Provider: my applications (must come BEFORE the generic /:jobId routes)
router.get('/my-applications', protect, authorizeRoleFromActive('provider'), getMyApplications);

// Recruiter: view applications for a specific job
router.get('/:jobId/applications', protect, authorizeRoleFromActive('recruiter'), getJobApplications);

// Recruiter: update application status
router.put('/applications/:applicationId', protect, authorizeRoleFromActive('recruiter'), updateApplicationStatus);

// Browse jobs (public, but logged-in providers get applied status)
router.get('/', optionalAuth, attachSubscription, getAvailableJobs);

// Provider: apply to job (with subscription limit check)
router.post('/:jobId/apply', protect, authorizeRoleFromActive('provider'), checkApplyLimit, applyToJob);

module.exports = router;
