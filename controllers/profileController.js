const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const Review = require('../models/Review');
const User = require('../models/User');
const { calculateReviewStats } = require('../services/reviewService');
const { getCoordinatesFromText, upsertLocationRecord } = require('../services/locationService');

const pickArray = (value) => (Array.isArray(value) ? value : undefined);
const toCoordinate = (value, min, max) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
};
const resolveRole = (user, preferredRole) => {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (preferredRole && roles.includes(preferredRole)) return preferredRole;
  return user.activeRole || roles[0] || user.role || null;
};

const getProfileByUserId = async (req, res) => {
  try {
    const targetUser = req.targetUser;
    const actorId = req.user._id.toString();
    const isOwner = actorId === targetUser._id.toString();

    let profile = null;
    let profileType = resolveRole(targetUser, req.query.role);

    if (targetUser.role === 'provider') {
      profile = await ProviderProfile.findOne({ user: targetUser._id }).lean();
      if (!profile) return res.status(404).json({ message: 'Provider profile not found' });
    } else if (targetUser.role === 'recruiter') {
      profile = await RecruiterProfile.findOne({ user: targetUser._id }).lean();
      if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });
    } else {
      profileType = 'admin';
      profile = {
        user: targetUser._id,
        city: '',
        description: '',
      };
    }

    const reviews = await Review.find({ revieweeId: targetUser._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('reviewerId', 'name roles activeRole role avatar profilePhoto')
      .lean();

    const ratingStats = await calculateReviewStats(targetUser._id);

    res.json({
      profileType,
      isOwner,
      canEdit: isOwner,
      user: {
        _id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email,
        roles: targetUser.roles || [],
        activeRole: targetUser.activeRole || targetUser.role || null,
        role: targetUser.activeRole || targetUser.role || null,
        avatar: targetUser.avatar || targetUser.profilePhoto || '',
      },
      profile: {
        ...profile,
        avgRating:
          profileType === 'provider'
            ? (profile.rating ?? ratingStats.avgRating)
            : (profile.avgRating ?? ratingStats.avgRating),
        totalReviews: profile.totalReviews ?? ratingStats.totalReviews,
      },
      reviews,
      ratingSummary: ratingStats,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

const updateMyProfile = async (req, res) => {
  try {
    const userId = req.user._id;

    const userUpdate = {};
    if (typeof req.body.name === 'string') userUpdate.name = req.body.name.trim();
    if (typeof req.body.avatar === 'string') userUpdate.avatar = req.body.avatar.trim();

    if (Object.keys(userUpdate).length) {
      await User.findByIdAndUpdate(userId, userUpdate, { new: true });
    }

    const actorRole = req.user.activeRole || req.user.role;

    if (actorRole === 'provider') {
      const profile = await ProviderProfile.findOne({ user: userId });
      if (!profile) return res.status(404).json({ message: 'Provider profile not found' });

      const nextSkills = pickArray(req.body.skills);
      const nextLanguages = pickArray(req.body.languages);
      const nextPortfolio = pickArray(req.body.portfolioLinks);

      if (nextSkills !== undefined) profile.skills = nextSkills;
      if (typeof req.body.experience === 'string') profile.experience = req.body.experience;
      if (typeof req.body.city === 'string') profile.city = req.body.city.trim();
      if (typeof req.body.state === 'string') profile.state = req.body.state.trim();
      if (typeof req.body.nearestLocation === 'string') profile.nearestLocation = req.body.nearestLocation.trim();
      const nextLat = toCoordinate(req.body.latitude, -90, 90);
      const nextLng = toCoordinate(req.body.longitude, -180, 180);
      if (nextLat !== null && nextLng !== null) {
        profile.latitude = nextLat;
        profile.longitude = nextLng;
        profile.locationUpdatedAt = new Date();
      }
      if (nextLanguages !== undefined) profile.languages = nextLanguages;
      if (typeof req.body.description === 'string') profile.description = req.body.description;
      if (nextPortfolio !== undefined) profile.portfolioLinks = nextPortfolio;

      await profile.save();
      if (profile.city) {
        let lat = profile.latitude;
        let lon = profile.longitude;

        if (lat === null || lon === null) {
          const geocoded = await getCoordinatesFromText([profile.city, profile.state].filter(Boolean).join(', '));
          if (geocoded) {
            lat = geocoded.lat;
            lon = geocoded.lon;
            profile.latitude = lat;
            profile.longitude = lon;
            profile.locationUpdatedAt = new Date();
            await profile.save();
          }
        }

        if (lat !== null && lon !== null) {
          await upsertLocationRecord({
            name: profile.nearestLocation || profile.city,
            latitude: lat,
            longitude: lon,
            type: 'provider',
          });
        }
      }
      const user = await User.findById(userId).select('_id name email roles activeRole role avatar profilePhoto');
      return res.json({ message: 'Profile updated', profileType: 'provider', user, profile });
    }

    if (actorRole === 'recruiter') {
      const profile = await RecruiterProfile.findOne({ user: userId });
      if (!profile) return res.status(404).json({ message: 'Recruiter profile not found' });

      if (typeof req.body.companyName === 'string') profile.companyName = req.body.companyName;
      if (typeof req.body.companyType === 'string') profile.companyType = req.body.companyType;
      if (typeof req.body.city === 'string') profile.city = req.body.city.trim();
      if (typeof req.body.state === 'string') profile.state = req.body.state.trim();
      if (typeof req.body.nearestLocation === 'string') profile.nearestLocation = req.body.nearestLocation.trim();
      const nextLat = toCoordinate(req.body.latitude, -90, 90);
      const nextLng = toCoordinate(req.body.longitude, -180, 180);
      if (nextLat !== null && nextLng !== null) {
        profile.latitude = nextLat;
        profile.longitude = nextLng;
        profile.locationUpdatedAt = new Date();
      }
      if (typeof req.body.description === 'string') profile.description = req.body.description;
      const nextSkillsNeeded = pickArray(req.body.skillsNeeded);
      if (nextSkillsNeeded !== undefined) profile.skillsNeeded = nextSkillsNeeded;

      await profile.save();
      if (profile.city) {
        let lat = profile.latitude;
        let lon = profile.longitude;

        if (lat === null || lon === null) {
          const geocoded = await getCoordinatesFromText([profile.city, profile.state].filter(Boolean).join(', '));
          if (geocoded) {
            lat = geocoded.lat;
            lon = geocoded.lon;
            profile.latitude = lat;
            profile.longitude = lon;
            profile.locationUpdatedAt = new Date();
            await profile.save();
          }
        }

        if (lat !== null && lon !== null) {
          await upsertLocationRecord({
            name: profile.nearestLocation || profile.city,
            latitude: lat,
            longitude: lon,
            type: 'recruiter',
          });
        }
      }
      const user = await User.findById(userId).select('_id name email roles activeRole role avatar profilePhoto');
      return res.json({ message: 'Profile updated', profileType: 'recruiter', user, profile });
    }

    // Admin account fallback
    const user = await User.findById(userId).select('_id name email roles activeRole role avatar profilePhoto');
    res.json({ message: 'Profile updated', profileType: 'admin', user, profile: null });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getProfileByUserId,
  updateMyProfile,
};
