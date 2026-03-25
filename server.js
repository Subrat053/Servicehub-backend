const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const providerRoutes = require('./routes/providerRoutes');
const recruiterRoutes = require('./routes/recruiterRoutes');
const adminRoutes = require('./routes/adminRoutes');
const jobRoutes = require('./routes/jobRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const { startCronJobs } = require('./utils/cronJobs');
const { setIO } = require('./services/notificationService');
const { detectLocaleFromRequest, reverseGeocodeCoordinates } = require('./utils/geoLocation');
const { getExchangeRates } = require('./utils/exchangeRates');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: { origin: true, credentials: true },
});

// Pass io to notification service
setIO(io);

io.on('connection', (socket) => {
  // Clients join a room named after their userId for targeted notifications
  socket.on('join', (userId) => {
    if (userId) socket.join(`user_${userId}`);
  });

  socket.on('disconnect', () => {});
});

// Connect Database
connectDB();

const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : false);

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: true,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stripe webhook – must receive RAW body before express.json() parses it
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  require('./controllers/paymentController').stripeWebhook
);

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploads
app.use('/uploads', express.static(require('path').join(__dirname, 'uploads')));

// Public skill categories (no auth required)
app.get('/api/skills', async (req, res) => {
  try {
    const SkillCategory = require('./models/SkillCategory');
    const cats = await SkillCategory.find({ isActive: true }).sort({ tier: 1, sortOrder: 1 });
    res.json(cats);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/user', require('./routes/userRoutes'));
app.use('/api/provider', providerRoutes);
app.use('/api/recruiter', recruiterRoutes);
// Debug: log incoming admin route requests to help diagnose 404/401 issues
app.use('/api/admin', (req, res, next) => {
  try {
    const authPresent = !!(req.headers && req.headers.authorization);
    console.log(`[ADMIN DEBUG] ${new Date().toISOString()} ${req.method} ${req.originalUrl} auth:${authPresent}`);
  } catch (e) {
    // ignore logging errors
  }
  next();
});
app.use('/api/admin', adminRoutes);

// Debug ping for admin routing checks
app.get('/api/admin/debug-ping', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));
app.use('/api/faq', require('./routes/faqRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/jobs', jobRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/profile', require('./routes/profileRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/location', require('./routes/locationRoutes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Localization: detect country from request
app.get('/api/locale/detect', async (req, res) => {
  const fallback = { country: 'US', currency: 'USD', locale: 'en' };

  try {
    const detected = await detectLocaleFromRequest(req);
    const jwt = require('jsonwebtoken');
    const User = require('./models/User');

    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(auth.split(' ')[1], process.env.JWT_SECRET);
        if (decoded?.id) {
          const user = await User.findById(decoded.id).select('country currency locale preferredLanguage');
          if (user) {
            const userCountry = user.country || '';
            const userCurrency = user.currency || '';
            const userLocale = user.preferredLanguage || user.locale || '';

            if (userCountry && userCurrency && userLocale) {
              return res.json({ country: userCountry, currency: userCurrency, locale: userLocale, source: 'user' });
            }

            user.country = user.country || detected.country;
            user.currency = user.currency || detected.currency;
            user.locale = user.locale || detected.locale;
            user.preferredLanguage = user.preferredLanguage || user.locale;
            await user.save();

            return res.json({
              country: user.country,
              currency: user.currency,
              locale: user.preferredLanguage || user.locale,
              source: 'detected-and-synced',
            });
          }
        }
      } catch (_) {
        // Ignore token decode errors for public fallback behavior.
      }
    }

    return res.json({
      country: detected.country || fallback.country,
      currency: detected.currency || fallback.currency,
      locale: detected.locale || fallback.locale,
      source: detected.source || 'detected',
    });
  } catch (_) {
    return res.json(fallback);
  }
});

// Reverse geocoding (free): lat/lng -> nearest city/state/country
app.get('/api/locale/reverse-geocode', async (req, res) => {
  const { lat, lng } = req.query;
  if (lat === undefined || lng === undefined) {
    return res.status(400).json({ message: 'lat and lng query params are required' });
  }

  const result = await reverseGeocodeCoordinates(lat, lng);
  if (!result) {
    return res.status(400).json({ message: 'Unable to resolve nearest location for provided coordinates' });
  }

  return res.json(result);
});

// Currency config (public)
app.get('/api/locale/currencies', async (req, res) => {
  try {
    const AdminSetting = require('./models/AdminSetting');
    const settings = await AdminSetting.find({ category: 'currency' });
    const config = {};
    settings.forEach(s => { config[s.key] = s.value; });

    const fallbackInrAed = parseFloat(config.exchange_rate_INR_AED) || 0.044;
    const fallbackInrUsd = parseFloat(config.exchange_rate_INR_USD) || 0.012;
    const exchangeRates = await getExchangeRates({
      fallbackInrAed,
      fallbackInrUsd,
    });

    res.json({
      INR: { symbol: '₹', code: 'INR', locale: 'en-IN' },
      AED: { symbol: 'AED', code: 'AED', locale: 'en-AE' },
      USD: { symbol: '$', code: 'USD', locale: 'en-US' },
      exchangeRates: {
        INR_AED: exchangeRates.INR_AED,
        INR_USD: exchangeRates.INR_USD,
      },
      exchangeSource: exchangeRates.source,
      exchangeFetchedAt: exchangeRates.fetchedAt,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/', (req, res)=>{
    res.send('Welcome to the Job Portal API');
})

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startCronJobs();
});
