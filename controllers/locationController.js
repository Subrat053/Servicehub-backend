const {
  getAutocompleteSuggestions,
  getNearbyFromAPI,
  getNearbyFromDB,
  mergeResults,
} = require('../services/locationService');

const sendResponse = (res, success, data, message, status = 200) => {
  return res.status(status).json({
    success,
    data,
    message,
  });
};

const autocompleteLocation = async (req, res) => {
  try {
    const { query } = req.body || {};
    if (!query || String(query).trim().length < 3) {
      return sendResponse(res, true, [], 'Type at least 3 characters for suggestions.');
    }

    const suggestions = await getAutocompleteSuggestions(query);
    return sendResponse(res, true, suggestions, 'Autocomplete suggestions fetched successfully.');
  } catch (error) {
    return sendResponse(res, false, [], error.message || 'Failed to fetch autocomplete suggestions.', 500);
  }
};

const nearbyLocations = async (req, res) => {
  try {
    const { lat, lon } = req.body || {};

    if (lat === undefined || lon === undefined) {
      return sendResponse(res, false, [], 'lat and lon are required.', 400);
    }

    const [apiResults, dbResults] = await Promise.all([
      getNearbyFromAPI(lat, lon),
      getNearbyFromDB(lat, lon),
    ]);

    const merged = mergeResults(apiResults, dbResults);
    return sendResponse(res, true, merged, 'Nearby locations fetched successfully.');
  } catch (error) {
    return sendResponse(res, false, [], error.message || 'Failed to fetch nearby locations.', 500);
  }
};

module.exports = {
  autocompleteLocation,
  nearbyLocations,
};
