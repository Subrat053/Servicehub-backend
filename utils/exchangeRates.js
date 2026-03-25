const DEFAULT_TTL_MS = Number(process.env.EXCHANGE_RATE_CACHE_TTL_MS || 60 * 60 * 1000);
const DEFAULT_API_URL = process.env.EXCHANGE_RATE_API_URL || 'https://api.exchangerate-api.com/v4/latest/USD';

let cachedRates = null;
let cacheExpiresAt = 0;

const toPositiveNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const computeInrRatesFromUsdBase = (rates) => {
  const usdToInr = toPositiveNumber(rates?.INR);
  const usdToAed = toPositiveNumber(rates?.AED);
  if (!usdToInr || !usdToAed) return null;

  const inrToUsd = 1 / usdToInr;
  const inrToAed = usdToAed / usdToInr;

  return {
    INR_USD: Number(inrToUsd.toFixed(6)),
    INR_AED: Number(inrToAed.toFixed(6)),
  };
};

const fetchLiveRates = async () => {
  const response = await fetch(DEFAULT_API_URL);
  if (!response.ok) {
    throw new Error(`Exchange API failed with status ${response.status}`);
  }

  const payload = await response.json();
  const derived = computeInrRatesFromUsdBase(payload?.rates || {});
  if (!derived) {
    throw new Error('Exchange API response missing INR/AED rates');
  }

  const now = new Date();
  return {
    ...derived,
    fetchedAt: now.toISOString(),
    source: 'exchangerate-api',
  };
};

const getExchangeRates = async ({ fallbackInrUsd = 0.012, fallbackInrAed = 0.044 } = {}) => {
  const nowMs = Date.now();

  if (cachedRates && cacheExpiresAt > nowMs) {
    return cachedRates;
  }

  try {
    const live = await fetchLiveRates();
    cachedRates = live;
    cacheExpiresAt = nowMs + DEFAULT_TTL_MS;
    return live;
  } catch (_) {
    const safeRates = {
      INR_USD: Number(fallbackInrUsd),
      INR_AED: Number(fallbackInrAed),
      fetchedAt: new Date().toISOString(),
      source: 'fallback',
    };

    cachedRates = safeRates;
    cacheExpiresAt = nowMs + Math.min(DEFAULT_TTL_MS, 10 * 60 * 1000);
    return safeRates;
  }
};

module.exports = {
  getExchangeRates,
};
