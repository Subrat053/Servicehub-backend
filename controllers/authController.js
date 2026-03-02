const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const Otp = require('../models/Otp');
const generateToken = require('../utils/generateToken');
const { generateOTP, sendPhoneOTP, sendEmailOTP, sendWhatsAppMessage } = require('../utils/messaging');

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

    const user = await User.create({
      name,
      email,
      phone: phone || '',
      password,
      role,
      authProvider: 'email',
      termsAccepted: true,
      ipAddress: req.ip,
    });

    // Create role-specific profile
    if (role === 'provider') {
      await ProviderProfile.create({
        user: user._id,
        city: '',
        profileExpiresAt: new Date(Date.now() + parseInt(process.env.PROFILE_VALIDITY_DAYS || 365) * 24 * 60 * 60 * 1000),
      });
    } else {
      await RecruiterProfile.create({
        user: user._id,
        freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    }

    const token = generateToken(user._id, user.role);

    res.status(201).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      token,
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
    const { name, email, googleId, avatar, role } = req.body;

    if (!email || !googleId) {
      return res.status(400).json({ message: 'Google auth data required' });
    }

    let user = await User.findOne({ email });

    if (user) {
      // Existing user - login with their existing role
      if (user.isBlocked) {
        return res.status(403).json({ message: 'Account blocked' });
      }
      // If user provides a different role than registered, inform them
      if (role && role !== user.role) {
        return res.status(400).json({ 
          message: `This email is already registered as a ${user.role}. Logging you in with your existing role.`,
          existingRole: user.role
        });
      }
      user.lastLogin = new Date();
      user.googleId = googleId;
      if (avatar) user.avatar = avatar;
      await user.save();
    } else {
      // New user - signup
      if (!role) {
        return res.status(400).json({ message: 'Role is required for new signup' });
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
          city: '',
          profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      } else if (role === 'recruiter') {
        await RecruiterProfile.create({
          user: user._id,
          freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }
    }

    const token = generateToken(user._id, user.role);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      token,
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

    if (user) {
      // Existing user
      user.isPhoneVerified = true;
      user.lastLogin = new Date();
      await user.save();
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
          city: '',
          profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      } else if (role === 'recruiter') {
        await RecruiterProfile.create({
          user: user._id,
          freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }

      await sendWhatsAppMessage(phone, 'welcome', { name: user.name });
    }

    const token = generateToken(user._id, user.role);

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      token,
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

module.exports = {
  registerEmail,
  loginUser,
  googleAuth,
  whatsappSendOtp,
  whatsappVerifyOtp,
  sendEmailVerification,
  confirmEmailVerification,
  getMe,
};
