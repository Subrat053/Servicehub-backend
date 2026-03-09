const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', registerEmail);
router.post('/login', loginUser);
router.post('/google', googleAuth);
router.post('/whatsapp/send-otp', whatsappSendOtp);
router.post('/whatsapp/verify-otp', whatsappVerifyOtp);
router.post('/verify-email/send', protect, sendEmailVerification);
router.post('/verify-email/confirm', protect, confirmEmailVerification);
router.get('/me', protect, getMe);
router.put('/whatsapp-number', protect, updateWhatsappNumber);
router.put('/locale', protect, updateLocale);
router.put('/whatsapp-alerts', protect, toggleWhatsappAlerts);

module.exports = router;
