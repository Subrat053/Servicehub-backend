const RecruiterProfile = require('../models/RecruiterProfile');

const ensureRecruiterApproved = async (req, res, next) => {
  try {
    const profile = await RecruiterProfile.findOne({ user: req.user._id }).select('isApproved');

    if (!profile) {
      return res.status(403).json({
        message: 'Recruiter profile not found. Please complete profile setup first.',
        approvalRequired: true,
      });
    }

    if (profile.isApproved !== true) {
      return res.status(403).json({
        message: 'Your recruiter account is pending admin approval.',
        approvalRequired: true,
      });
    }

    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  ensureRecruiterApproved,
};
