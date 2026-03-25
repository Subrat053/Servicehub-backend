const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const UserSubscription = require('../models/UserSubscription');
const Otp = require('../models/Otp');
const generateToken = require('../utils/generateToken');
const { generateOTP, sendPhoneOTP, sendEmailOTP, sendWhatsAppMessage } = require('../utils/messaging');
const { assignFreePlan } = require('./subscriptionController');
const {
  SUPPORTED_LOCALES,
  detectLocaleFromRequest,
  normalizeCountryCode,
  normalizeCurrencyCode,
  normalizeLanguageCode,
} = require('../utils/geoLocation');

const VALID_ROLES = ['provider', 'recruiter'];
const OTP_VALIDITY_MS = 10 * 60 * 1000;
const VALIDITY_DAYS = parseInt(process.env.PROFILE_VALIDITY_DAYS || 365, 10);

const issueEmailOtp = async (email) => {
  const otp = generateOTP();
  await Otp.create({
    identifier: email,
    otp,
    type: 'email',
    expiresAt: new Date(Date.now() + OTP_VALIDITY_MS),
  });
  await sendEmailOTP(email, otp);
};

const normalizeRoles = (user) => {
  const roles = Array.isArray(user.roles) ? [...new Set(user.roles)] : [];
  if (user.role && !roles.includes(user.role)) roles.push(user.role);
  if (user.activeRole && !roles.includes(user.activeRole)) roles.push(user.activeRole);

  let activeRole = user.activeRole || roles[0] || user.role || null;
  if (roles.includes('admin')) activeRole = 'admin';
  else if (roles.includes('manager')) activeRole = 'manager';

  return { roles, activeRole };
};

const parseRoleSelection = (payload = {}) => {
  const candidateRoles = [];
  if (Array.isArray(payload.roles)) candidateRoles.push(...payload.roles);
  if (typeof payload.role === 'string') candidateRoles.push(payload.role);

  const roles = [...new Set(candidateRoles.filter((role) => VALID_ROLES.includes(role)))];
  const requestedActiveRole = payload.activeRole;
  const activeRole = roles.includes(requestedActiveRole) ? requestedActiveRole : (roles[0] || null);

  return { roles, activeRole };
};

const ensureRoleProfile = async (userId, role) => {
  if (role === 'provider') {
    let profile = await ProviderProfile.findOne({ user: userId });
    if (!profile) {
      profile = await ProviderProfile.create({
        user: userId,
        city: '',
        profileExpiresAt: new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      });
    }
    return profile;
  }

  if (role === 'recruiter') {
    let profile = await RecruiterProfile.findOne({ user: userId });
    if (!profile) {
      profile = await RecruiterProfile.create({
        user: userId,
        freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        freeUnlockResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        unlocksRemaining: 2,
        unlockPackSize: 2,
        profileExpiresAt: new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      });
    }
    return profile;
  }

  return null;
};

const ensureRoleSubscription = async (user, role, options = {}) => {
  if (!VALID_ROLES.includes(role)) return;

  const existing = await UserSubscription.findOne({
    userId: user._id,
    role,
    status: 'active',
    endDate: { $gt: new Date() },
  }).sort({ createdAt: -1 });
  if (existing) return;

  await assignFreePlan(user._id, role);
};

const getProfileByRole = async (userId, role) => {
  if (role === 'provider') return ProviderProfile.findOne({ user: userId });
  if (role === 'recruiter') return RecruiterProfile.findOne({ user: userId });
  return null;
};

const buildAuthPayload = (user, extra = {}) => {
  const { roles, activeRole } = normalizeRoles(user);
  const token = generateToken(user._id, activeRole);

  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    whatsappNumber: user.whatsappNumber,
    roles,
    activeRole,
    role: activeRole,
    avatar: user.avatar,
    country: user.country,
    currency: user.currency,
    locale: user.locale,
    preferredLanguage: user.preferredLanguage || user.locale,
    token,
    ...extra,
  };
};

// @desc    Register user with email
// @route   POST /api/auth/register
const registerEmail = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const { roles: requestedRoles, activeRole: requestedActiveRole } = parseRoleSelection(req.body);

    if (!name || !normalizedEmail || !password) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const userExists = await User.findOne({ email: normalizedEmail }).select('+role');
    if (userExists) {
      if (userExists.authProvider !== 'email' || userExists.isEmailVerified) {
        return res.status(400).json({
          message: 'This email is already registered. Please login instead or use a different email.',
          existingRoles: normalizeRoles(userExists).roles,
        });
      }

      const normalized = normalizeRoles(userExists);
      const nextRoles = [...new Set([...normalized.roles, ...requestedRoles])];
      const nextActiveRole = requestedActiveRole || normalized.activeRole || nextRoles[0] || null;

      userExists.name = name;
      userExists.phone = phone || '';
      userExists.password = password;
      userExists.termsAccepted = true;
      userExists.ipAddress = req.ip;
      userExists.roles = nextRoles;
      userExists.activeRole = nextActiveRole;
      await userExists.save();

      if (userExists.activeRole && VALID_ROLES.includes(userExists.activeRole)) {
        await ensureRoleProfile(userExists._id, userExists.activeRole);
        await ensureRoleSubscription(userExists, userExists.activeRole);
      }

      await issueEmailOtp(userExists.email);

      return res.json({
        message: 'OTP sent to your email. Please verify to complete registration.',
        requiresEmailVerification: true,
        email: userExists.email,
        roles: userExists.roles || [],
        activeRole: userExists.activeRole || null,
      });
    }

    const detectedLocale = await detectLocaleFromRequest(req);
    const user = await User.create({
      name,
      email: normalizedEmail,
      phone: phone || '',
      password,
      roles: requestedRoles,
      activeRole: requestedActiveRole,
      role: requestedActiveRole || null,
      authProvider: 'email',
      termsAccepted: true,
      ipAddress: detectedLocale.ip || req.ip,
      country: detectedLocale.country,
      currency: detectedLocale.currency,
      locale: detectedLocale.locale,
      preferredLanguage: detectedLocale.locale,
      accountExpiresAt: new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    });

    if (user.activeRole) {
      await ensureRoleProfile(user._id, user.activeRole);
      await ensureRoleSubscription(user, user.activeRole, { startDate: user.createdAt });
    }

    await issueEmailOtp(user.email);

    res.status(201).json({
      message: 'OTP sent to your email. Please verify to complete registration.',
      requiresEmailVerification: true,
      email: user.email,
      roles: user.roles || [],
      activeRole: user.activeRole || null,
      isNewUser: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Send (or resend) registration email OTP
// @route   POST /api/auth/register/send-otp
const sendRegistrationEmailOtp = async (req, res) => {
  try {
    const normalizedEmail = (req.body.email || '').trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: normalizedEmail });
    if (!user || user.authProvider !== 'email') {
      return res.status(404).json({ message: 'No email account found for this address' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account blocked. Contact admin.' });
    }
    if (user.isEmailVerified) {
      return res.status(400).json({ message: 'Email is already verified. Please login.' });
    }

    await issueEmailOtp(user.email);
    res.json({ message: 'Verification OTP sent to email' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Confirm registration email OTP and activate account
// @route   POST /api/auth/register/verify-otp
const confirmRegistrationEmailOtp = async (req, res) => {
  try {
    const { email, otp, whatsappNumber } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const user = await User.findOne({ email: normalizedEmail }).select('+role');
    if (!user || user.authProvider !== 'email') {
      return res.status(404).json({ message: 'No email account found for this address' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account blocked. Contact admin.' });
    }

    const record = await Otp.findOne({
      identifier: normalizedEmail,
      otp,
      isUsed: false,
      type: 'email',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP' });

    record.isUsed = true;
    await record.save();

    const normalized = normalizeRoles(user);
    user.roles = normalized.roles;
    user.activeRole = normalized.activeRole;
    user.isEmailVerified = true;
    user.lastLogin = new Date();
    user.ipAddress = req.ip;
    if (whatsappNumber) {
      user.whatsappNumber = whatsappNumber;
      user.whatsappConsent = true;
    }
    await user.save();

    if (user.activeRole) {
      await ensureRoleProfile(user._id, user.activeRole);
      await ensureRoleSubscription(user, user.activeRole);
    }

    res.json(buildAuthPayload(user, { isNewUser: true }));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = (email || '').trim().toLowerCase();

    const user = await User.findOne({ email: normalizedEmail }).select('+role');
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account blocked. Contact admin.' });
    }

    if (user.authProvider !== 'email') {
      return res.status(400).json({
        message:
          user.authProvider === 'google'
            ? 'This account uses Google sign-in. Please continue with Google.'
            : 'This account uses WhatsApp sign-in. Please continue with WhatsApp OTP.',
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isEmailVerified) {
      const hasOtpHistory = await Otp.exists({ identifier: user.email, type: 'email' });

      if (hasOtpHistory) {
        await issueEmailOtp(user.email);
        return res.status(403).json({
          message: 'Email not verified. We sent a fresh OTP to your email.',
          requiresEmailVerification: true,
          email: user.email,
        });
      }

      user.isEmailVerified = true;
    }

    const normalized = normalizeRoles(user);
    user.roles = normalized.roles;
    user.activeRole = normalized.activeRole;
    user.lastLogin = new Date();
    user.ipAddress = req.ip;

    if (!user.country || !user.currency || !user.locale) {
      const detectedLocale = await detectLocaleFromRequest(req);
      user.country = user.country || detectedLocale.country;
      user.currency = user.currency || detectedLocale.currency;
      user.locale = user.locale || detectedLocale.locale;
      user.preferredLanguage = user.preferredLanguage || user.locale;
    }

    await user.save();

    if (user.activeRole) {
      await ensureRoleProfile(user._id, user.activeRole);
      await ensureRoleSubscription(user, user.activeRole);
    }

    res.json(buildAuthPayload(user));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Google login/signup
// @route   POST /api/auth/google
const googleAuth = async (req, res) => {
  try {
    const { accessToken } = req.body;
    const { roles: requestedRoles, activeRole: requestedActiveRole } = parseRoleSelection(req.body);

    if (!accessToken) {
      return res.status(400).json({ message: 'Google access token required' });
    }

    const googleRes = await fetch(
      `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${encodeURIComponent(accessToken)}`
    );

    if (!googleRes.ok) {
      return res.status(401).json({ message: 'Invalid or expired Google token' });
    }

    const googleUser = await googleRes.json();
    const { sub: googleId, name, email, picture: avatar, email_verified } = googleUser;

    if (!email || !googleId) {
      return res.status(400).json({ message: 'Could not retrieve Google account info' });
    }
    if (!email_verified) {
      return res.status(400).json({ message: 'Google account email is not verified' });
    }

    let user = await User.findOne({ email }).select('+role');
    let isNewUser = false;

    if (user) {
      if (user.isBlocked) {
        return res.status(403).json({ message: 'Account blocked' });
      }

      const normalized = normalizeRoles(user);
      const nextRoles = [...new Set([...normalized.roles, ...requestedRoles])];

      user.lastLogin = new Date();
      user.googleId = googleId;
      if (avatar) user.avatar = avatar;
      user.roles = nextRoles;
      user.activeRole = requestedActiveRole || normalized.activeRole || nextRoles[0] || null;
      await user.save();

      if (user.activeRole) {
        await ensureRoleProfile(user._id, user.activeRole);
        await ensureRoleSubscription(user, user.activeRole);
      }
    } else {
      const detectedLocale = await detectLocaleFromRequest(req);
      user = await User.create({
        name,
        email,
        googleId,
        avatar: avatar || '',
        roles: requestedRoles,
        activeRole: requestedActiveRole,
        role: requestedActiveRole || null,
        authProvider: 'google',
        isEmailVerified: true,
        termsAccepted: true,
        ipAddress: detectedLocale.ip || req.ip,
        country: detectedLocale.country,
        currency: detectedLocale.currency,
        locale: detectedLocale.locale,
        preferredLanguage: detectedLocale.locale,
      });

      if (user.activeRole) {
        await ensureRoleProfile(user._id, user.activeRole);
        await ensureRoleSubscription(user, user.activeRole, { startDate: user.createdAt });
      }

      isNewUser = true;
    }

    res.json(buildAuthPayload(user, { isNewUser }));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    WhatsApp login/signup - send OTP
// @route   POST /api/auth/whatsapp/send-otp
const whatsappSendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone number required' });

    const otp = generateOTP();
    await Otp.create({
      identifier: phone,
      otp,
      type: 'phone',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendPhoneOTP(phone, otp);
    res.json({ message: 'OTP sent to WhatsApp', phone });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    WhatsApp login/signup - verify OTP
// @route   POST /api/auth/whatsapp/verify-otp
const whatsappVerifyOtp = async (req, res) => {
  try {
    const { phone, otp, name } = req.body;
    const { roles: requestedRoles, activeRole: requestedActiveRole } = parseRoleSelection(req.body);
    if (!phone || !otp) return res.status(400).json({ message: 'Phone and OTP required' });

    const otpRecord = await Otp.findOne({
      identifier: phone,
      otp,
      isUsed: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpRecord) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    otpRecord.isUsed = true;
    await otpRecord.save();

    let user = await User.findOne({ phone }).select('+role');
    let isNewUser = false;

    if (user) {
      const normalized = normalizeRoles(user);
      const nextRoles = [...new Set([...normalized.roles, ...requestedRoles])];

      user.roles = nextRoles;
      user.activeRole = requestedActiveRole || normalized.activeRole || nextRoles[0] || null;
      user.isPhoneVerified = true;
      user.lastLogin = new Date();
      await user.save();

      if (user.activeRole) {
        await ensureRoleProfile(user._id, user.activeRole);
        await ensureRoleSubscription(user, user.activeRole);
      }
    } else {
      if (!name) {
        return res.status(400).json({ message: 'Name required for new user', needsRegistration: true, phoneVerified: true });
      }

      const detectedLocale = await detectLocaleFromRequest(req);
      user = await User.create({
        name,
        email: `${phone}@whatsapp.servicehub.com`,
        phone,
        roles: requestedRoles,
        activeRole: requestedActiveRole,
        role: requestedActiveRole || null,
        authProvider: 'whatsapp',
        isPhoneVerified: true,
        whatsappConsent: true,
        termsAccepted: true,
        ipAddress: detectedLocale.ip || req.ip,
        country: detectedLocale.country,
        currency: detectedLocale.currency,
        locale: detectedLocale.locale,
        preferredLanguage: detectedLocale.locale,
      });

      if (user.activeRole) {
        await ensureRoleProfile(user._id, user.activeRole);
        await ensureRoleSubscription(user, user.activeRole, { startDate: user.createdAt });
      }

      isNewUser = true;
      await sendWhatsAppMessage(phone, 'welcome', { name: user.name });
    }

    res.json(buildAuthPayload(user, { isNewUser }));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Send email OTP for verification
// @route   POST /api/auth/verify-email/send
const sendEmailVerification = async (req, res) => {
  try {
    const otp = generateOTP();
    await Otp.create({
      identifier: req.user.email,
      otp,
      type: 'email',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    await sendEmailOTP(req.user.email, otp);
    res.json({ message: 'Verification OTP sent to email' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Verify email OTP
// @route   POST /api/auth/verify-email/confirm
const confirmEmailVerification = async (req, res) => {
  try {
    const { otp } = req.body;
    const record = await Otp.findOne({
      identifier: req.user.email,
      otp,
      isUsed: false,
      type: 'email',
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!record) return res.status(400).json({ message: 'Invalid or expired OTP' });

    record.isUsed = true;
    await record.save();

    req.user.isEmailVerified = true;
    await req.user.save();

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get current user
// @route   GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password +role');
    const normalized = normalizeRoles(user);
    user.roles = normalized.roles;
    user.activeRole = normalized.activeRole;

    const profile = user.activeRole ? await getProfileByRole(user._id, user.activeRole) : null;

    res.json({
      user: {
        ...user.toObject(),
        role: user.activeRole,
      },
      profile,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Switch active role
// @route   POST /api/auth/switch-role
const switchRole = async (req, res) => {
  try {
    const role = req.body.role || req.body.panel;
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role/panel. Allowed values: provider, recruiter.' });
    }

    const user = await User.findById(req.user._id).select('-password +role');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const normalized = normalizeRoles(user);
    if (normalized.roles.includes('admin') || normalized.roles.includes('manager')) {
      return res.status(403).json({ message: 'Role switching is not available for admin or manager accounts.' });
    }

    const nextRoles = [...new Set([...normalized.roles, role])];

    user.roles = nextRoles;
    user.activeRole = role;
    await user.save();

    await ensureRoleProfile(user._id, role);
    await ensureRoleSubscription(user, role);

    const profile = await getProfileByRole(user._id, role);

    res.json({
      user: {
        ...user.toObject(),
        role: role,
      },
      roles: user.roles,
      activeRole: role,
      panel: role,
      redirectPath: `/${role}/dashboard`,
      profile,
      token: generateToken(user._id, role),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update WhatsApp number (for email/google signup users)
// @route   PUT /api/auth/whatsapp-number
const updateWhatsappNumber = async (req, res) => {
  try {
    const { whatsappNumber } = req.body;
    if (!whatsappNumber) return res.status(400).json({ message: 'WhatsApp number is required' });

    const user = await User.findById(req.user._id);
    user.whatsappNumber = whatsappNumber;
    user.whatsappConsent = true;
    await user.save();

    res.json({ message: 'WhatsApp number updated', whatsappNumber: user.whatsappNumber });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update user locale/country preference
// @route   PUT /api/auth/locale
const updateLocale = async (req, res) => {
  try {
    const { locale, language, country, currency } = req.body;
    const user = await User.findById(req.user._id);
    const nextLanguage = locale || language;

    const nextLocaleCode = normalizeLanguageCode(nextLanguage);
    const nextCountryCode = normalizeCountryCode(country);
    const nextCurrencyCode = normalizeCurrencyCode(currency);

    if (nextLocaleCode && SUPPORTED_LOCALES.has(nextLocaleCode)) {
      user.locale = nextLocaleCode;
      user.preferredLanguage = nextLocaleCode;
    }
    if (nextCountryCode) user.country = nextCountryCode;
    if (nextCurrencyCode) user.currency = nextCurrencyCode;
    await user.save();

    res.json({
      locale: user.locale,
      preferredLanguage: user.preferredLanguage || user.locale,
      country: user.country,
      currency: user.currency,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update user language preference
// @route   PUT /api/user/language
const updateLanguagePreference = async (req, res) => {
  try {
    const { language } = req.body;
    if (!language || !SUPPORTED_LOCALES.has(language)) {
      return res.status(400).json({ message: 'Unsupported language' });
    }

    const user = await User.findById(req.user._id);
    user.locale = language;
    user.preferredLanguage = language;
    await user.save();

    res.json({ language: user.preferredLanguage, locale: user.locale });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Toggle WhatsApp alerts
// @route   PUT /api/auth/whatsapp-alerts
const toggleWhatsappAlerts = async (req, res) => {
  try {
    const { enabled } = req.body;
    const user = await User.findById(req.user._id).select('+role');
    user.whatsappAlerts = enabled !== false;
    await user.save();

    const activeRole = user.activeRole || user.role;
    if (activeRole === 'provider') {
      await ProviderProfile.findOneAndUpdate({ user: user._id }, { whatsappAlerts: user.whatsappAlerts });
    } else if (activeRole === 'recruiter') {
      await RecruiterProfile.findOneAndUpdate({ user: user._id }, { whatsappAlerts: user.whatsappAlerts });
    }

    res.json({ whatsappAlerts: user.whatsappAlerts });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  registerEmail,
  sendRegistrationEmailOtp,
  confirmRegistrationEmailOtp,
  loginUser,
  googleAuth,
  whatsappSendOtp,
  whatsappVerifyOtp,
  sendEmailVerification,
  confirmEmailVerification,
  getMe,
  switchRole,
  updateWhatsappNumber,
  updateLocale,
  updateLanguagePreference,
  toggleWhatsappAlerts,
};
