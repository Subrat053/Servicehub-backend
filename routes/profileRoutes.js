const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { loadTargetUser, enforceProfileViewAccess } = require('../middleware/profileAccess');
const { getProfileByUserId, updateMyProfile } = require('../controllers/profileController');

router.get('/:id', protect, loadTargetUser, enforceProfileViewAccess, getProfileByUserId);
router.patch('/', protect, updateMyProfile);

module.exports = router;
