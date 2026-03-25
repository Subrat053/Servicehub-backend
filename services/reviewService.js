const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const Review = require('../models/Review');
const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');

const NON_ADMIN_ROLES = new Set(['provider', 'recruiter']);
const REVIEW_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

const buildRolePair = (reviewer, reviewee) => {
  if (!reviewer || !reviewee) return null;
  if (!NON_ADMIN_ROLES.has(reviewer.role) || !NON_ADMIN_ROLES.has(reviewee.role)) return null;
  if (reviewer.role === reviewee.role) return null;

  const providerId = reviewer.role === 'provider' ? reviewer._id : reviewee._id;
  const recruiterId = reviewer.role === 'recruiter' ? reviewer._id : reviewee._id;
  return { providerId, recruiterId };
};

const resolveLeadInteraction = async ({ providerId, recruiterId, leadId }) => {
  const query = {
    provider: providerId,
    recruiter: recruiterId,
    $or: [
      { isUnlocked: true },
      { status: { $in: ['contacted', 'hired', 'rejected'] } },
      { type: { $in: ['contact_unlock', 'direct_contact'] } },
    ],
  };

  if (leadId) {
    if (!mongoose.Types.ObjectId.isValid(leadId)) return null;
    query._id = leadId;
  }

  return Lead.findOne(query).sort({ createdAt: -1 });
};

const calculateReviewStats = async (revieweeId) => {
  const stats = await Review.aggregate([
    { $match: { revieweeId: new mongoose.Types.ObjectId(revieweeId) } },
    {
      $group: {
        _id: '$revieweeId',
        avgRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 },
      },
    },
  ]);

  if (!stats.length) return { avgRating: 0, totalReviews: 0 };
  return {
    avgRating: Number(stats[0].avgRating.toFixed(1)),
    totalReviews: stats[0].totalReviews,
  };
};

const syncProfileRating = async (revieweeUser) => {
  const { avgRating, totalReviews } = await calculateReviewStats(revieweeUser._id);

  if (revieweeUser.role === 'provider') {
    await ProviderProfile.findOneAndUpdate(
      { user: revieweeUser._id },
      { rating: avgRating, totalReviews }
    );
  } else if (revieweeUser.role === 'recruiter') {
    await RecruiterProfile.findOneAndUpdate(
      { user: revieweeUser._id },
      { avgRating, totalReviews }
    );
  }

  return { avgRating, totalReviews };
};

const createReviewForUsers = async ({ reviewer, reviewee, rating, comment, leadId }) => {
  if (!reviewer || !reviewee) {
    return { ok: false, status: 400, message: 'Reviewer and reviewee are required' };
  }
  if (reviewer._id.toString() === reviewee._id.toString()) {
    return { ok: false, status: 400, message: 'You cannot review yourself' };
  }
  if (reviewer.role === 'admin') {
    return { ok: false, status: 403, message: 'Admin users cannot submit reviews' };
  }

  const pair = buildRolePair(reviewer, reviewee);
  if (!pair) {
    return { ok: false, status: 403, message: 'Reviews are only allowed between provider and recruiter' };
  }

  const normalizedRating = Number(rating);
  if (!Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
    return { ok: false, status: 400, message: 'Rating must be between 1 and 5' };
  }

  const interaction = await resolveLeadInteraction({
    providerId: pair.providerId,
    recruiterId: pair.recruiterId,
    leadId,
  });
  if (!interaction) {
    return { ok: false, status: 403, message: 'Review requires a valid prior interaction' };
  }

  const duplicate = await Review.findOne({
    reviewerId: reviewer._id,
    revieweeId: reviewee._id,
    leadId: interaction._id,
  });
  if (duplicate) {
    return { ok: false, status: 409, message: 'You have already reviewed this interaction' };
  }

  const review = await Review.create({
    reviewerId: reviewer._id,
    revieweeId: reviewee._id,
    provider: pair.providerId,
    recruiter: pair.recruiterId,
    leadId: interaction._id,
    jobPost: interaction.jobPost || null,
    rating: normalizedRating,
    comment: typeof comment === 'string' ? comment.trim() : '',
  });

  const stats = await syncProfileRating(reviewee);
  return { ok: true, review, stats, interaction };
};

const canUserReview = async ({ reviewer, revieweeId, leadId }) => {
  if (!reviewer || reviewer.role === 'admin') {
    return { canReview: false, reason: 'Admins cannot review' };
  }

  if (!mongoose.Types.ObjectId.isValid(revieweeId)) {
    return { canReview: false, reason: 'Invalid reviewee id' };
  }

  const reviewee = await User.findById(revieweeId).select('_id role');
  if (!reviewee) return { canReview: false, reason: 'User not found' };

  const pair = buildRolePair(reviewer, reviewee);
  if (!pair) return { canReview: false, reason: 'Cross-role reviews only' };

  const interaction = await resolveLeadInteraction({
    providerId: pair.providerId,
    recruiterId: pair.recruiterId,
    leadId,
  });

  if (!interaction) return { canReview: false, reason: 'No eligible interaction found' };

  const existing = await Review.findOne({
    reviewerId: reviewer._id,
    revieweeId: reviewee._id,
    leadId: interaction._id,
  }).select('_id');

  return {
    canReview: !existing,
    reason: existing ? 'Review already exists for this interaction' : '',
    leadId: interaction._id,
  };
};

const canMutateReview = (review) => {
  const ageMs = Date.now() - new Date(review.createdAt).getTime();
  return ageMs <= REVIEW_EDIT_WINDOW_MS;
};

const updateReviewByOwner = async ({ reviewId, reviewer, rating, comment }) => {
  const review = await Review.findOne({ _id: reviewId, reviewerId: reviewer._id });
  if (!review) {
    return { ok: false, status: 404, message: 'Review not found or not owned by you' };
  }

  if (!canMutateReview(review)) {
    return { ok: false, status: 403, message: 'Review can only be edited within 24 hours' };
  }

  const updates = {};
  if (rating !== undefined) {
    const normalizedRating = Number(rating);
    if (!Number.isFinite(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
      return { ok: false, status: 400, message: 'Rating must be between 1 and 5' };
    }
    updates.rating = normalizedRating;
  }

  if (comment !== undefined) {
    updates.comment = typeof comment === 'string' ? comment.trim() : '';
  }

  if (!Object.keys(updates).length) {
    return { ok: false, status: 400, message: 'No valid fields to update' };
  }

  Object.assign(review, updates);
  await review.save();

  const reviewee = await User.findById(review.revieweeId).select('_id role');
  const stats = reviewee ? await syncProfileRating(reviewee) : { avgRating: 0, totalReviews: 0 };

  return { ok: true, review, stats };
};

const deleteReviewByOwner = async ({ reviewId, reviewer }) => {
  const review = await Review.findOne({ _id: reviewId, reviewerId: reviewer._id });
  if (!review) {
    return { ok: false, status: 404, message: 'Review not found or not owned by you' };
  }

  if (!canMutateReview(review)) {
    return { ok: false, status: 403, message: 'Review can only be deleted within 24 hours' };
  }

  const reviewee = await User.findById(review.revieweeId).select('_id role');
  await review.deleteOne();
  const stats = reviewee ? await syncProfileRating(reviewee) : { avgRating: 0, totalReviews: 0 };

  return { ok: true, stats };
};

module.exports = {
  buildRolePair,
  calculateReviewStats,
  syncProfileRating,
  createReviewForUsers,
  canUserReview,
  updateReviewByOwner,
  deleteReviewByOwner,
};
