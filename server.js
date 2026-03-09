const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes');
const providerRoutes = require('./routes/providerRoutes');
const recruiterRoutes = require('./routes/recruiterRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { startCronJobs } = require('./utils/cronJobs');

const app = express();

// Connect Database
connectDB();

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
app.use('/api/provider', providerRoutes);
app.use('/api/recruiter', recruiterRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/faq', require('./routes/faqRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Localization: detect country from request
app.get('/api/locale/detect', (req, res) => {
  // Simple IP-based detection (can be enhanced with GeoIP)
  const ip = req.ip || req.connection.remoteAddress || '';
  // Default to India; UAE detection can be added with GeoIP service
  const country = 'IN';
  const currency = country === 'AE' ? 'AED' : 'INR';
  const locale = 'en';
  res.json({ country, currency, locale });
});

// Currency config (public)
app.get('/api/locale/currencies', async (req, res) => {
  try {
    const AdminSetting = require('./models/AdminSetting');
    const settings = await AdminSetting.find({ category: 'currency' });
    const config = {};
    settings.forEach(s => { config[s.key] = s.value; });
    res.json({
      INR: { symbol: '₹', code: 'INR', locale: 'en-IN' },
      AED: { symbol: 'AED', code: 'AED', locale: 'en-AE' },
      USD: { symbol: '$', code: 'USD', locale: 'en-US' },
      exchangeRates: {
        INR_AED: parseFloat(config.exchange_rate_INR_AED) || 0.044,
        INR_USD: parseFloat(config.exchange_rate_INR_USD) || 0.012,
      },
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startCronJobs();
});
