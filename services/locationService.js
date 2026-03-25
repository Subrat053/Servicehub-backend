const axios = require('axios');
const Location = require('../models/Location');
const { haversineDistanceKm } = require('../utils/distance');

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;
const RADIUS_METERS = 50000;
const RESULT_LIMIT = 20;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizePlace = (item, source, origin) => {
  const lat = toNumber(item.lat ?? item.latitude);
  const lon = toNumber(item.lon ?? item.longitude);
  if (lat === null || lon === null) return null;

  const normalized = {
    name: item.name || item.formatted || item.city || 'Unknown',
    lat,
    lon,
    source,
  };

  if (origin) {
    normalized.distance = haversineDistanceKm(origin.lat, origin.lon, lat, lon);
  }

  return normalized;
};

async function getCoordinatesFromText(text) {
  if (!text || !String(text).trim()) return null;
  if (!GEOAPIFY_API_KEY) throw new Error('GEOAPIFY_API_KEY is not configured');

  const { data } = await axios.get('https://api.geoapify.com/v1/geocode/search', {
    params: {
      text: String(text).trim(),
      limit: 1,
      apiKey: GEOAPIFY_API_KEY,
    },
    timeout: 6000,
  });

  const feature = data?.features?.[0];
  const lat = toNumber(feature?.properties?.lat);
  const lon = toNumber(feature?.properties?.lon);
  if (lat === null || lon === null) return null;

  return { lat, lon };
}

async function getAutocompleteSuggestions(text) {
  const query = String(text || '').trim();
  if (!query || query.length < 3) return [];
  if (!GEOAPIFY_API_KEY) return [];

  const { data } = await axios.get('https://api.geoapify.com/v1/geocode/autocomplete', {
    params: {
      text: query,
      limit: 10,
      type: 'city',
      apiKey: GEOAPIFY_API_KEY,
    },
    timeout: 6000,
  });

  const features = Array.isArray(data?.features) ? data.features : [];

  return features
    .map((feature) => {
      const lat = toNumber(feature?.properties?.lat);
      const lon = toNumber(feature?.properties?.lon);
      if (lat === null || lon === null) return null;

      return {
        id: feature?.properties?.place_id || `${lat},${lon}`,
        name: feature?.properties?.formatted || feature?.properties?.city || query,
        lat,
        lon,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

async function getNearbyFromAPI(lat, lon) {
  const origin = { lat: toNumber(lat), lon: toNumber(lon) };
  if (origin.lat === null || origin.lon === null) return [];
  if (!GEOAPIFY_API_KEY) return [];

  const { data } = await axios.get('https://api.geoapify.com/v2/places', {
    params: {
      categories: 'populated_place.city',
      filter: `circle:${origin.lon},${origin.lat},${RADIUS_METERS}`,
      limit: RESULT_LIMIT,
      apiKey: GEOAPIFY_API_KEY,
    },
    timeout: 7000,
  });

  const features = Array.isArray(data?.features) ? data.features : [];

  return features
    .map((feature) => {
      const props = feature?.properties || {};
      return normalizePlace({
        name: props.city || props.name || props.formatted,
        lat: props.lat,
        lon: props.lon,
      }, 'api', origin);
    })
    .filter(Boolean);
}

async function getNearbyFromDB(lat, lon) {
  const origin = { lat: toNumber(lat), lon: toNumber(lon) };
  if (origin.lat === null || origin.lon === null) return [];

  const locations = await Location.find({}).select('name latitude longitude type').lean();

  return locations
    .map((item) => {
      const distance = haversineDistanceKm(origin.lat, origin.lon, item.latitude, item.longitude);
      return {
        name: item.name,
        lat: item.latitude,
        lon: item.longitude,
        distance,
        source: 'db',
      };
    })
    .filter((item) => item.distance <= 50);
}

function mergeResults(apiResults, dbResults) {
  const seen = new Set();
  const merged = [];

  [...apiResults, ...dbResults].forEach((item) => {
    if (!item) return;
    const lat = toNumber(item.lat);
    const lon = toNumber(item.lon);
    if (lat === null || lon === null) return;

    const key = `${String(item.name || '').toLowerCase()}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) return;

    const distance = item.distance ?? null;
    merged.push({
      name: item.name,
      lat,
      lon,
      source: item.source,
      ...(distance !== null ? { distance } : {}),
    });
    seen.add(key);
  });

  return merged
    .sort((a, b) => {
      const da = a.distance ?? Number.POSITIVE_INFINITY;
      const db = b.distance ?? Number.POSITIVE_INFINITY;
      return da - db;
    })
    .slice(0, RESULT_LIMIT);
}

async function upsertLocationRecord({ name, latitude, longitude, type = 'place' }) {
  if (!name) return null;
  const lat = toNumber(latitude);
  const lon = toNumber(longitude);
  if (lat === null || lon === null) return null;

  const existing = await Location.findOne({
    name: String(name).trim(),
    latitude: { $gte: lat - 0.0001, $lte: lat + 0.0001 },
    longitude: { $gte: lon - 0.0001, $lte: lon + 0.0001 },
  });

  if (existing) return existing;

  return Location.create({
    name: String(name).trim(),
    latitude: lat,
    longitude: lon,
    type,
  });
}

module.exports = {
  getCoordinatesFromText,
  getAutocompleteSuggestions,
  getNearbyFromAPI,
  getNearbyFromDB,
  mergeResults,
  upsertLocationRecord,
};
