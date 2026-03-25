const User = require('../models/User');

const normalizeRoles = (user) => {
  const roles = Array.isArray(user.roles) ? [...new Set(user.roles)] : [];
  if (user.role && !roles.includes(user.role)) roles.push(user.role);
  if (user.activeRole && !roles.includes(user.activeRole)) roles.push(user.activeRole);
  return roles;
};

const loadTargetUser = async (req, res, next) => {
  try {
    const targetUser = await User.findById(req.params.id).select('_id role roles activeRole name email avatar profilePhoto');
    if (!targetUser) return res.status(404).json({ message: 'Profile user not found' });

    req.targetUser = targetUser;
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const enforceProfileViewAccess = (req, res, next) => {
  const actor = req.user;
  const target = req.targetUser;

  if (!actor || !target) {
    return res.status(500).json({ message: 'Access context missing' });
  }

  if (actor._id.toString() === target._id.toString()) return next();

  const actorRoles = normalizeRoles(actor);
  const targetRoles = normalizeRoles(target);
  const actorActiveRole = actor.activeRole || actor.role;

  if (actorRoles.includes('admin') || actorActiveRole === 'admin') return next();

  // Block same-role access only against the actor's active role.
  if (actorActiveRole && targetRoles.includes(actorActiveRole)) {
    return res.status(403).json({ message: 'Access denied for same-role profile view' });
  }

  // Provider <-> Recruiter cross-view is allowed.
  const allowedCrossRole =
    (actorActiveRole === 'provider' && targetRoles.includes('recruiter')) ||
    (actorActiveRole === 'recruiter' && targetRoles.includes('provider'));

  if (!allowedCrossRole) {
    return res.status(403).json({ message: 'Access denied' });
  }

  next();
};

module.exports = {
  loadTargetUser,
  enforceProfileViewAccess,
};
