const ProviderProfile = require('../models/ProviderProfile');
const { haversineDistanceKm } = require('../utils/distance');
const { getRotatedProviders } = require('../utils/rotation');

const DEFAULT_RADIUS_KM = Number(process.env.SEARCH_RADIUS_KM || 50);
const DEFAULT_FEATURED_LIMIT = Number(process.env.FEATURED_LIMIT || 5);

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isEnterpriseProvider = (provider) => {
  const plan = String(provider?.subscriptionPlan || provider?.currentPlan || '').toLowerCase();
  return plan === 'enterprise' || plan === 'featured' || plan === 'pro';
};

const hasActiveSubscription = (provider, now = new Date()) => {
  if (provider?.isActiveSubscription === true) {
    if (!provider.subscriptionEndDate) return true;
    return new Date(provider.subscriptionEndDate).getTime() > now.getTime();
  }

  if (provider?.subscriptionEndDate) {
    return new Date(provider.subscriptionEndDate).getTime() > now.getTime();
  }

  if (provider?.planExpiresAt) {
    return new Date(provider.planExpiresAt).getTime() > now.getTime();
  }

  return false;
};

async function getProvidersByLocation(lat, lon, radiusKm = DEFAULT_RADIUS_KM, providers = null) {
  const centerLat = toNumber(lat);
  const centerLon = toNumber(lon);
  const radius = toNumber(radiusKm) || DEFAULT_RADIUS_KM;

  if (centerLat === null || centerLon === null) {
    return Array.isArray(providers) ? providers : [];
  }

  const source = Array.isArray(providers)
    ? providers
    : await ProviderProfile.find({ isApproved: true }).populate('user', 'name avatar email').lean();

  return source
    .map((provider) => {
      const pLat = toNumber(provider.latitude);
      const pLon = toNumber(provider.longitude);
      if (pLat === null || pLon === null) return null;

      const distanceKm = haversineDistanceKm(centerLat, centerLon, pLat, pLon);
      if (distanceKm > radius) return null;

      return { ...provider, distanceKm };
    })
    .filter(Boolean);
}

function filterActiveSubscriptions(providers, now = new Date()) {
  if (!Array.isArray(providers)) return [];
  return providers.filter((provider) => hasActiveSubscription(provider, now));
}

function separateProviders(providers, now = new Date()) {
  if (!Array.isArray(providers)) return { featuredProviders: [], normalProviders: [] };

  const featuredProviders = [];
  const normalProviders = [];

  providers.forEach((provider) => {
    const activeSubscription = hasActiveSubscription(provider, now);
    const enterprise = isEnterpriseProvider(provider);

    if (enterprise && activeSubscription) {
      featuredProviders.push(provider);
      return;
    }

    normalProviders.push(provider);
  });

  return { featuredProviders, normalProviders };
}

function applyRotation(featuredProviders, intervalSeconds = process.env.ROTATION_INTERVAL_SEC, featuredLimit = DEFAULT_FEATURED_LIMIT) {
  const rotated = getRotatedProviders(featuredProviders, Number(intervalSeconds) || 60);
  return rotated.slice(0, Number(featuredLimit) || DEFAULT_FEATURED_LIMIT);
}

function mergeFinalList(featuredProviders, normalProviders) {
  const seen = new Set();
  const merged = [];

  [...(featuredProviders || []), ...(normalProviders || [])].forEach((provider) => {
    const id = provider?._id?.toString?.() || provider?.user?._id?.toString?.();
    if (!id || seen.has(id)) return;
    seen.add(id);
    merged.push(provider);
  });

  return merged;
}

module.exports = {
  getProvidersByLocation,
  filterActiveSubscriptions,
  separateProviders,
  applyRotation,
  mergeFinalList,
};
