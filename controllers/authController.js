const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const Otp = require('../models/Otp');
const generateToken = require('../utils/generateToken');
const { generateOTP, sendPhoneOTP, sendEmailOTP, sendWhatsAppMessage } = require('../utils/messaging');
const { assignFreePlan } = require('./subscriptionController');

// Helper: detect country from IP (simple heuristic)
function detectCountryFromIP(ip) {
  // Default to India; actual GeoIP can be added later
  return 'IN';
}
function getDefaultCurrency(country) {
  return country === 'AE' ? 'AED' : 'INR';
}
function getDefaultLocale(country) {
  if (country === 'AE') return 'en'; // UAE uses English primarily
  return 'en';
}
const VALIDITY_DAYS = parseInt(process.env.PROFILE_VALIDITY_DAYS || 365);

// @desc    Register user with email
// @route   POST /api/auth/register
const registerEmail = async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Please fill all required fields' });
    }
    if (!['provider', 'recruiter'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ 
        message: `This email is already registered as a ${userExists.role}. Please login instead or use a different email.`,
        existingRole: userExists.role
      });
    }

    const country = detectCountryFromIP(req.ip);
    const user = await User.create({
      name,
      email,
      phone: phone || '',
      password,
      role,
      authProvider: 'email',
      termsAccepted: true,
      ipAddress: req.ip,
      country,
      currency: getDefaultCurrency(country),
      locale: getDefaultLocale(country),
      accountExpiresAt: new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    });

    // Create role-specific profile
    if (role === 'provider') {
      await ProviderProfile.create({
        user: user._id,
        city: '',
        profileExpiresAt: new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      });
    } else {
      await RecruiterProfile.create({
        user: user._id,
        freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        profileExpiresAt: new Date(Date.now() + VALIDITY_DAYS * 24 * 60 * 60 * 1000),
      });
    }

    // Auto-assign free plan subscription
    await assignFreePlan(user._id, role);

    const token = generateToken(user._id, user.role);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
      isNewUser: true,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: 'Account blocked. Contact admin.' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    user.lastLogin = new Date();
    user.ipAddress = req.ip;
    await user.save();

    const token = generateToken(user._id, user.role);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      avatar: user.avatar,
      token,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Google login/signup
// @route   POST /api/auth/google
const googleAuth = async (req, res) => {
  try {
    const { accessToken, role } = req.body;

    if (!accessToken) {
      return res.status(400).json({ message: 'Google access token required' });
    }

    // Verify the access token by calling Google's userinfo endpoint
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

    let user = await User.findOne({ email });

    let isNewUser = false;
    if (user) {
      // Existing user - login with their existing role
      if (user.isBlocked) {
        return res.status(403).json({ message: 'Account blocked' });
      }
      // If user provides a different role than registered, inform them
      if (role && role !== user.role) {
        return res.status(400).json({
          message: `This email is already registered as a ${user.role}. Logging you in with your existing role.`,
          existingRole: user.role,
        });
      }
      user.lastLogin = new Date();
      user.googleId = googleId;
      if (avatar) user.avatar = avatar;
      await user.save();

      // Auto-create profile if it somehow doesn't exist
      if (user.role === 'provider') {
        const exists = await ProviderProfile.findOne({ user: user._id });
        if (!exists) {
          await ProviderProfile.create({ user: user._id, profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) });
          isNewUser = true;
        }
      } else if (user.role === 'recruiter') {
        const exists = await RecruiterProfile.findOne({ user: user._id });
        if (!exists) {
          await RecruiterProfile.create({ user: user._id, freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
          isNewUser = true;
        }
      }
    } else {
      // New user - signup
      if (!role) {
        return res.status(400).json({ message: 'Role is required for new signup' });
      }
      if (!['provider', 'recruiter'].includes(role)) {
        return res.status(400).json({ message: 'Invalid role' });
      }
      user = await User.create({
        name,
        email,
        googleId,
        avatar: avatar || '',
        role,
        authProvider: 'google',
        isEmailVerified: true,
        termsAccepted: true,
        ipAddress: req.ip,
      });

      if (role === 'provider') {
        await ProviderProfile.create({
          user: user._id,
          profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      } else if (role === 'recruiter') {
        await RecruiterProfile.create({
          user: user._id,
          freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }
      isNewUser = true;

      // Auto-assign free plan subscription
      await assignFreePlan(user._id, role);
    }

    const token = generateToken(user._id, user.role);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      token,
      isNewUser,
    });
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
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min
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
    const { phone, otp, name, role } = req.body;
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

    let user = await User.findOne({ phone });
    let isNewUser = false;

    if (user) {
      // Existing user
      user.isPhoneVerified = true;
      user.lastLogin = new Date();
      await user.save();

      // Auto-create profile if missing
      if (user.role === 'provider') {
        const exists = await ProviderProfile.findOne({ user: user._id });
        if (!exists) {
          await ProviderProfile.create({ user: user._id, profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) });
          isNewUser = true;
        }
      } else if (user.role === 'recruiter') {
        const exists = await RecruiterProfile.findOne({ user: user._id });
        if (!exists) {
          await RecruiterProfile.create({ user: user._id, freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
          isNewUser = true;
        }
      }
    } else {
      // New user
      if (!name || !role) {
        return res.status(400).json({ message: 'Name and role required for new user', needsRegistration: true, phoneVerified: true });
      }
      user = await User.create({
        name,
        email: `${phone}@whatsapp.servicehub.com`,
        phone,
        role,
        authProvider: 'whatsapp',
        isPhoneVerified: true,
        whatsappConsent: true,
        termsAccepted: true,
        ipAddress: req.ip,
      });

      if (role === 'provider') {
        await ProviderProfile.create({
          user: user._id,
          profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      } else if (role === 'recruiter') {
        await RecruiterProfile.create({
          user: user._id,
          freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }
      isNewUser = true;
      await sendWhatsAppMessage(phone, 'welcome', { name: user.name });

      // Auto-assign free plan subscription
      await assignFreePlan(user._id, role);
    }

    const token = generateToken(user._id, user.role);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      token,
      isNewUser,
    });
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
    const user = await User.findById(req.user._id).select('-password');
    let profile = null;

    if (user.role === 'provider') {
      profile = await ProviderProfile.findOne({ user: user._id });
    } else if (user.role === 'recruiter') {
      profile = await RecruiterProfile.findOne({ user: user._id });
    }

    res.json({ user, profile });
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
    const { locale, country, currency } = req.body;
    const user = await User.findById(req.user._id);

    if (locale && ['en', 'hi', 'ar'].includes(locale)) user.locale = locale;
    if (country && ['IN', 'AE'].includes(country)) user.country = country;
    if (currency && ['INR', 'AED', 'USD'].includes(currency)) user.currency = currency;
    await user.save();

    res.json({ locale: user.locale, country: user.country, currency: user.currency });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Toggle WhatsApp alerts
// @route   PUT /api/auth/whatsapp-alerts
const toggleWhatsappAlerts = async (req, res) => {
  try {
    const { enabled } = req.body;
    const user = await User.findById(req.user._id);
    user.whatsappAlerts = enabled !== false;
    await user.save();

    // Also update profile-level alerts
    if (user.role === 'provider') {
      await ProviderProfile.findOneAndUpdate({ user: user._id }, { whatsappAlerts: user.whatsappAlerts });
    } else if (user.role === 'recruiter') {
      await RecruiterProfile.findOneAndUpdate({ user: user._id }, { whatsappAlerts: user.whatsappAlerts });
    }

    res.json({ whatsappAlerts: user.whatsappAlerts });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  registerEmail,
  loginUser,
  googleAuth,
  whatsappSendOtp,
  whatsappVerifyOtp,
  sendEmailVerification,
  confirmEmailVerification,
  getMe,
  updateWhatsappNumber,
  updateLocale,
  toggleWhatsappAlerts,
};
