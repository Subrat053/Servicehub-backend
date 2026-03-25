const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  createReview,
  getReviewsForUser,
  getCanReviewStatus,
  updateReview,
  deleteReview,
} = require('../controllers/reviewController');

router.post('/', protect, createReview);
router.get('/can-review/:revieweeId', protect, getCanReviewStatus);
router.patch('/:id', protect, updateReview);
router.delete('/:id', protect, deleteReview);
router.get('/:userId', protect, getReviewsForUser);

module.exports = router;
