const User = require('../models/User');
const Review = require('../models/Review');
const {
  createReviewForUsers,
  canUserReview,
  calculateReviewStats,
  updateReviewByOwner,
  deleteReviewByOwner,
} = require('../services/reviewService');

const createReview = async (req, res) => {
  try {
    const { revieweeId, rating, comment, leadId } = req.body;

    if (!revieweeId) {
      return res.status(400).json({ message: 'revieweeId is required' });
    }

    const reviewee = await User.findById(revieweeId).select('_id role name');
    if (!reviewee) return res.status(404).json({ message: 'Reviewee user not found' });

    const result = await createReviewForUsers({
      reviewer: req.user,
      reviewee,
      rating,
      comment,
      leadId,
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    const populated = await Review.findById(result.review._id)
      .populate('reviewerId', 'name role avatar profilePhoto')
      .populate('revieweeId', 'name role')
      .lean();

    res.status(201).json({
      message: 'Review submitted successfully',
      review: populated,
      ratingSummary: result.stats,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: 'You already reviewed this interaction' });
    }
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getReviewsForUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const reviewee = await User.findById(userId).select('_id');
    if (!reviewee) return res.status(404).json({ message: 'User not found' });

    const reviews = await Review.find({ revieweeId: userId })
      .sort({ createdAt: -1 })
      .populate('reviewerId', 'name role avatar profilePhoto')
      .lean();

    const summary = await calculateReviewStats(userId);

    res.json({
      reviews,
      avgRating: summary.avgRating,
      totalReviews: summary.totalReviews,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const getCanReviewStatus = async (req, res) => {
  try {
    const { revieweeId } = req.params;
    const { leadId } = req.query;

    const status = await canUserReview({
      reviewer: req.user,
      revieweeId,
      leadId,
    });

    res.json(status);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    const result = await updateReviewByOwner({
      reviewId: id,
      reviewer: req.user,
      rating,
      comment,
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    const populated = await Review.findById(result.review._id)
      .populate('reviewerId', 'name role avatar profilePhoto')
      .populate('revieweeId', 'name role')
      .lean();

    return res.json({
      message: 'Review updated successfully',
      review: populated,
      ratingSummary: result.stats,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const deleteReview = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await deleteReviewByOwner({
      reviewId: id,
      reviewer: req.user,
    });

    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }

    return res.json({
      message: 'Review deleted successfully',
      ratingSummary: result.stats,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Legacy recruiter route compatibility: POST /api/recruiter/review/:providerId
const addReviewLegacy = async (req, res) => {
  try {
    const providerId = req.params.providerId;
    return createReview(
      {
        ...req,
        body: {
          revieweeId: providerId,
          rating: req.body.rating,
          comment: req.body.comment,
          leadId: req.body.leadId,
        },
      },
      res
    );
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  createReview,
  getReviewsForUser,
  getCanReviewStatus,
  updateReview,
  deleteReview,
  addReviewLegacy,
};
