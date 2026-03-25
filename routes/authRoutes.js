const express = require('express');
const router = express.Router();
const {
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
  toggleWhatsappAlerts,
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', registerEmail);
router.post('/register/send-otp', sendRegistrationEmailOtp);
router.post('/register/verify-otp', confirmRegistrationEmailOtp);
router.post('/login', loginUser);
router.post('/google', googleAuth);
router.post('/whatsapp/send-otp', whatsappSendOtp);
router.post('/whatsapp/verify-otp', whatsappVerifyOtp);
router.post('/verify-email/send', protect, sendEmailVerification);
router.post('/verify-email/confirm', protect, confirmEmailVerification);
router.get('/me', protect, getMe);
router.post('/switch-role', protect, switchRole);
router.put('/whatsapp-number', protect, updateWhatsappNumber);
router.put('/locale', protect, updateLocale);
router.put('/whatsapp-alerts', protect, toggleWhatsappAlerts);

module.exports = router;
