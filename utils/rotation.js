function getRotatedProviders(providers, intervalSeconds = 60) {
  if (!Array.isArray(providers) || providers.length === 0) return [];

  const safeInterval = Number(intervalSeconds) > 0 ? Number(intervalSeconds) : 60;
  const slot = Math.floor(Date.now() / 1000 / safeInterval);
  const index = slot % providers.length;

  return providers.slice(index).concat(providers.slice(0, index));
}

module.exports = {
  getRotatedProviders,
};
