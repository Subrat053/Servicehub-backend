const jwt = require('jsonwebtoken');
const User = require('../models/User');

const normalizeUserRoles = (user) => {
  const roles = Array.isArray(user.roles) ? [...new Set(user.roles)] : [];
  const legacyRole = user.role;

  if (legacyRole && !roles.includes(legacyRole)) {
    roles.push(legacyRole);
  }

  let activeRole = user.activeRole;
  if (!activeRole) activeRole = roles[0] || null;
  if (activeRole && !roles.includes(activeRole)) roles.push(activeRole);

  return { roles, activeRole };
};

// Protect routes - verify JWT
const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, no token' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password +role');
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }

    const { roles, activeRole } = normalizeUserRoles(req.user);
    req.user.roles = roles;
    req.user.activeRole = activeRole;

    if (req.user.isBlocked) {
      return res.status(403).json({ message: 'Account blocked. Contact admin.' });
    }
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

// Role authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (req.user.activeRole === 'admin') return next();
    if (!roles.includes(req.user.activeRole)) {
      return res.status(403).json({ message: `Role '${req.user.activeRole}' is not authorized` });
    }
    next();
  };
};

const authorizeRoleFromActive = (requiredRole) => {
  return (req, res, next) => {
    if (req.user.activeRole === 'admin') return next();
    if (req.user.activeRole !== requiredRole) {
      return res.status(403).json({
        message: `Active role '${req.user.activeRole}' is not authorized for this route`,
      });
    }
    next();
  };
};

module.exports = { protect, authorize, authorizeRoleFromActive };
