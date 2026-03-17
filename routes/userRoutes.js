const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { updateLanguagePreference } = require('../controllers/authController');

router.put('/language', protect, updateLanguagePreference);

module.exports = router;
