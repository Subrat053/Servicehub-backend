const SUPPORTED_LOCALES = new Set(['en', 'hi', 'ar', 'ur', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt', 'id', 'bn', 'ta', 'te', 'mr']);

const COUNTRY_LANGUAGE_FALLBACK = {
  IN: 'hi',
  AE: 'ar',
  SA: 'ar',
  EG: 'ar',
  FR: 'fr',
  DE: 'de',
  ES: 'es',
  PT: 'pt',
  RU: 'ru',
  ID: 'id',
  BD: 'bn',
  CN: 'zh',
  JP: 'ja',
};

const COUNTRY_CURRENCY_FALLBACK = {
  IN: 'INR',
  AE: 'AED',
  SA: 'SAR',
  EG: 'EGP',
  FR: 'EUR',
  DE: 'EUR',
  ES: 'EUR',
  PT: 'EUR',
  GB: 'GBP',
  JP: 'JPY',
  AU: 'AUD',
  CA: 'CAD',
};

function normalizeCountryCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : '';
}

function normalizeCurrencyCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : '';
}

function normalizeLanguageCode(value) {
  const normalized = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.has(normalized) ? normalized : '';
}

function isPrivateOrLoopbackIp(ip) {
  if (!ip) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  return (
    ip === '::1'
    || ip === '127.0.0.1'
    || ip.startsWith('10.')
    || ip.startsWith('192.168.')
    || ip.startsWith('fc')
    || ip.startsWith('fd')
  );
}

function extractIpFromRequest(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const candidate = Array.isArray(forwarded)
    ? forwarded[0]
    : String(forwarded || '').split(',')[0].trim();
  const raw = candidate || req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || '';
  if (!raw) return '';
  return String(raw).replace(/^::ffff:/i, '');
}

function extractCountryFromAcceptLanguage(headerValue) {
  const value = String(headerValue || '').trim();
  if (!value) return '';

  const parts = value.split(',').map((item) => item.trim()).filter(Boolean);
  for (const part of parts) {
    const langTag = part.split(';')[0].trim();
    if (!langTag) continue;
    const segments = langTag.split('-');
    if (segments.length < 2) continue;
    const country = normalizeCountryCode(segments[segments.length - 1]);
    if (country) return country;
  }

  return '';
}

async function fetchGeoFromIpApi(ip) {
  const endpoint = `https://ipapi.co/${encodeURIComponent(ip)}/json/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(endpoint, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data || data.error) return null;

    const firstLanguage = String(data.languages || '').split(',')[0];
    return {
      country: normalizeCountryCode(data.country_code),
      currency: normalizeCurrencyCode(data.currency),
      locale: normalizeLanguageCode(firstLanguage),
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function detectLocaleFromRequest(req) {
  const countryFromEdge = normalizeCountryCode(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country']);
  const countryFromLanguage = extractCountryFromAcceptLanguage(req.headers['accept-language']);
  const ip = extractIpFromRequest(req);

  let detected = {
    country: countryFromEdge,
    currency: '',
    locale: '',
    ip,
    source: countryFromEdge ? 'edge' : 'default',
  };

  if ((!detected.country || !detected.currency || !detected.locale) && ip && !isPrivateOrLoopbackIp(ip)) {
    const apiResult = await fetchGeoFromIpApi(ip);
    if (apiResult) {
      detected = {
        ...detected,
        ...apiResult,
        country: detected.country || apiResult.country,
        source: detected.country ? detected.source : 'ipapi',
      };
      if (!countryFromEdge && apiResult.country) detected.source = 'ipapi';
    }
  }

  const finalCountry = detected.country || 'US';
  const resolvedCountry = finalCountry === 'US' && countryFromLanguage ? countryFromLanguage : finalCountry;
  const finalCurrency = detected.currency || COUNTRY_CURRENCY_FALLBACK[resolvedCountry] || 'USD';
  const finalLocale = detected.locale || COUNTRY_LANGUAGE_FALLBACK[resolvedCountry] || 'en';

  return {
    country: resolvedCountry,
    currency: finalCurrency,
    locale: finalLocale,
    ip: detected.ip,
    source: resolvedCountry !== finalCountry ? 'accept-language' : detected.source,
  };
}

function normalizeCoordinate(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

async function reverseGeocodeCoordinates(lat, lng) {
  const latitude = normalizeCoordinate(lat, -90, 90);
  const longitude = normalizeCoordinate(lng, -180, 180);

  if (latitude === null || longitude === null) {
    return null;
  }

  const endpoint = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=10&addressdetails=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'ServiceHub/1.0 (location-detection)',
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const address = data?.address || {};

    const city =
      address.city
      || address.town
      || address.village
      || address.municipality
      || address.county
      || '';

    const state = address.state || address.state_district || '';
    const country = address.country || '';
    const nearestLocation = data?.display_name || [city, state, country].filter(Boolean).join(', ');

    return {
      city,
      state,
      country,
      nearestLocation,
      latitude,
      longitude,
      source: 'nominatim',
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  SUPPORTED_LOCALES,
  detectLocaleFromRequest,
  normalizeCountryCode,
  normalizeCurrencyCode,
  normalizeLanguageCode,
  reverseGeocodeCoordinates,
};
