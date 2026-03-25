require('dotenv').config();
const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const Plan = require('../models/Plan');
const AdminSetting = require('../models/AdminSetting');
const JobPost = require('../models/JobPost');
const Lead = require('../models/Lead');
const Review = require('../models/Review');
const VisitHistory = require('../models/VisitHistory');
const RotationPool = require('../models/RotationPool');
const Payment = require('../models/Payment');
const UserSubscription = require('../models/UserSubscription');
const Application = require('../models/Application');
const Notification = require('../models/Notification');
const connectDB = require('../config/db');

const DAY_MS = 24 * 60 * 60 * 1000;

async function wipeDataKeepAdminUsers() {
  const adminUsers = await User.find({ roles: 'admin' }).select('_id email').lean();
  const adminIds = adminUsers.map((u) => u._id);

  await Promise.all([
    ProviderProfile.deleteMany({}),
    RecruiterProfile.deleteMany({}),
    JobPost.deleteMany({}),
    Lead.deleteMany({}),
    Review.deleteMany({}),
    VisitHistory.deleteMany({}),
    RotationPool.deleteMany({}),
    Payment.deleteMany({}),
    UserSubscription.deleteMany({}),
    Application.deleteMany({}),
    Notification.deleteMany({}),
    Plan.deleteMany({}),
    AdminSetting.deleteMany({}),
    User.deleteMany({ _id: { $nin: adminIds } }),
  ]);

  return adminUsers;
}

async function seedUsersAndProfiles() {
  const providerData = [
    {
      name: 'Rahul Kumar', email: 'rahul@test.com', phone: '9876543210', skills: ['Driver', 'Delivery'],
      city: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.2090, experience: '5 years', subscriptionPlan: 'free',
    },
    {
      name: 'Priya Sharma', email: 'priya@test.com', phone: '9876543211', skills: ['Tutor', 'Math Teacher'],
      city: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lon: 72.8777, experience: '3 years', subscriptionPlan: 'enterprise',
    },
    {
      name: 'Amit Patel', email: 'amit@test.com', phone: '9876543212', skills: ['Web Designer', 'Graphic Design'],
      city: 'Bangalore', state: 'Karnataka', lat: 12.9716, lon: 77.5946, experience: '4 years', subscriptionPlan: 'enterprise',
    },
    {
      name: 'Suman Devi', email: 'suman@test.com', phone: '9876543213', skills: ['Cook', 'Catering'],
      city: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.2090, experience: '8 years', subscriptionPlan: 'free',
    },
    {
      name: 'Vikram Singh', email: 'vikram@test.com', phone: '9876543214', skills: ['Plumber', 'Electrician'],
      city: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873, experience: '10 years', subscriptionPlan: 'enterprise',
    },
    {
      name: 'Neha Gupta', email: 'neha@test.com', phone: '9876543215', skills: ['Yoga Trainer', 'Fitness'],
      city: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lon: 72.8777, experience: '6 years', subscriptionPlan: 'free',
    },
    {
      name: 'Ravi Verma', email: 'ravi@test.com', phone: '9876543216', skills: ['Driver', 'Mechanic'],
      city: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.2090, experience: '7 years', subscriptionPlan: 'free',
    },
    {
      name: 'Anita Roy', email: 'anita@test.com', phone: '9876543217', skills: ['Tutor', 'English Teacher'],
      city: 'Kolkata', state: 'West Bengal', lat: 22.5726, lon: 88.3639, experience: '4 years', subscriptionPlan: 'enterprise',
    },
  ];

  const recruiterData = [
    {
      name: 'TechCorp HR', email: 'hr@techcorp.com', phone: '9988776655', company: 'TechCorp Pvt Ltd',
      type: 'company', city: 'Bangalore', state: 'Karnataka', lat: 12.9716, lon: 77.5946, approved: true,
    },
    {
      name: 'Ramesh Home', email: 'ramesh@test.com', phone: '9988776656', company: 'Ramesh Household Services',
      type: 'home', city: 'Delhi', state: 'Delhi', lat: 28.6139, lon: 77.2090, approved: true,
    },
    {
      name: 'ShopEasy', email: 'hire@shopeasy.com', phone: '9988776657', company: 'ShopEasy Store',
      type: 'shop', city: 'Mumbai', state: 'Maharashtra', lat: 19.0760, lon: 72.8777, approved: false,
    },
  ];

  const providerUsers = [];
  for (const pd of providerData) {
    const user = await User.create({
      name: pd.name,
      email: pd.email,
      phone: pd.phone,
      password: 'test123',
      roles: ['provider'],
      activeRole: 'provider',
      authProvider: 'email',
      isEmailVerified: true,
      isPhoneVerified: true,
      termsAccepted: true,
      locale: 'en',
      preferredLanguage: 'en',
      country: 'IN',
      currency: 'INR',
    });

    await ProviderProfile.create({
      user: user._id,
      skills: pd.skills,
      experience: pd.experience,
      city: pd.city,
      state: pd.state,
      nearestLocation: `${pd.city}, ${pd.state}, India`,
      latitude: pd.lat,
      longitude: pd.lon,
      locationUpdatedAt: new Date(),
      languages: ['Hindi', 'English'],
      description: `Experienced ${pd.skills[0]} based in ${pd.city}. Available for immediate work.`,
      profileCompletion: 80,
      isApproved: true,
      isVerified: true,
      currentPlan: pd.subscriptionPlan === 'enterprise' ? 'featured' : 'free',
      subscriptionPlan: pd.subscriptionPlan,
      subscriptionStartDate: new Date(Date.now() - 7 * DAY_MS),
      subscriptionEndDate: pd.subscriptionPlan === 'enterprise' ? new Date(Date.now() + 30 * DAY_MS) : new Date(Date.now() + 365 * DAY_MS),
      isActiveSubscription: true,
      rating: Math.round((3 + Math.random() * 2) * 10) / 10,
      totalReviews: Math.floor(Math.random() * 20) + 1,
      profileExpiresAt: new Date(Date.now() + 365 * DAY_MS),
    });

    providerUsers.push(user);
  }

  const recruiterUsers = [];
  for (const rd of recruiterData) {
    const user = await User.create({
      name: rd.name,
      email: rd.email,
      phone: rd.phone,
      password: 'test123',
      roles: ['recruiter'],
      activeRole: 'recruiter',
      authProvider: 'email',
      isEmailVerified: true,
      isPhoneVerified: true,
      termsAccepted: true,
      locale: 'en',
      preferredLanguage: 'en',
      country: 'IN',
      currency: 'INR',
    });

    await RecruiterProfile.create({
      user: user._id,
      companyName: rd.company,
      companyType: rd.type,
      city: rd.city,
      state: rd.state,
      nearestLocation: `${rd.city}, ${rd.state}, India`,
      latitude: rd.lat,
      longitude: rd.lon,
      locationUpdatedAt: new Date(),
      currentPlan: 'free',
      freeViewResetAt: new Date(Date.now() + 30 * DAY_MS),
      freeUnlockResetAt: new Date(Date.now() + 30 * DAY_MS),
      unlocksRemaining: 2,
      unlockPackSize: 2,
      isApproved: rd.approved,
      isVerified: rd.approved,
      profileExpiresAt: new Date(Date.now() + 365 * DAY_MS),
    });

    recruiterUsers.push(user);
  }

  return { providerUsers, recruiterUsers };
}

async function seedJobs(recruiterUsers) {
  const sampleJobs = [
    { title: 'House Painter Needed', skill: 'Painter', city: 'Mumbai', budgetMin: 5000, budgetMax: 12000, budgetType: 'fixed', description: 'Looking for an experienced house painter for 3 rooms.', requirements: ['Experience painting interiors', 'Own tools'] },
    { title: 'Math Tutor - Grade 10', skill: 'Tutor', city: 'Delhi', budgetMin: 500, budgetMax: 1000, budgetType: 'hourly', description: 'Looking for a patient math tutor for grade 10 student.', requirements: ['Teaching experience', 'Good communication'] },
    { title: 'Web Designer for Small Business', skill: 'Web Designer', city: 'Bangalore', budgetMin: 8000, budgetMax: 20000, budgetType: 'fixed', description: 'Design a 5-page website for a local business.', requirements: ['Portfolio', 'Responsive design'] },
    { title: 'Cook for Events', skill: 'Cook', city: 'Delhi', budgetMin: 10000, budgetMax: 25000, budgetType: 'fixed', description: 'Experienced cook required for catering small events.', requirements: ['Catering experience', 'Hygiene certifications'] },
  ];

  let jobsCreated = 0;
  for (let i = 0; i < sampleJobs.length; i++) {
    const recruiter = recruiterUsers[i % recruiterUsers.length];
    const job = sampleJobs[i];
    await JobPost.create({
      recruiter: recruiter._id,
      title: job.title,
      skill: job.skill,
      city: job.city,
      budgetMin: job.budgetMin,
      budgetMax: job.budgetMax,
      budgetType: job.budgetType,
      description: job.description,
      requirements: job.requirements,
      status: 'active',
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });
    jobsCreated++;
  }

  return jobsCreated;
}

async function seedPlansAndSettings() {
  const plans = [
    { name: 'Free', slug: 'free', type: 'provider', price: 0, duration: 365, features: ['Basic profile', 'Up to 4 skills', '2 job apply / month'], maxSkills: 4, boostWeight: 0, isRotationEligible: false, isActive: true, sortOrder: 0, jobPostLimit: 0, jobApplyLimit: 2, jobNotification: false, badgeEnabled: false, priorityListing: false },
    { name: 'Basic Boost', slug: 'basic', type: 'provider', price: 2000, duration: 30, features: ['Profile boosted in search', 'Up to 6 skills', 'Priority listing'], maxSkills: 6, boostWeight: 2, isRotationEligible: false, isActive: true, sortOrder: 1, jobPostLimit: 0, jobApplyLimit: 20, jobNotification: true, badgeEnabled: false, priorityListing: false },
    { name: 'Pro Boost', slug: 'pro', type: 'provider', price: 5000, duration: 30, features: ['All Basic features', 'Up to 10 skills', 'Featured badge', 'WhatsApp lead alerts'], maxSkills: 10, boostWeight: 5, isRotationEligible: false, isActive: true, sortOrder: 2, jobPostLimit: 0, jobApplyLimit: -1, jobNotification: true, badgeEnabled: true, priorityListing: true },
    { name: 'Featured', slug: 'featured', type: 'provider', price: 10000, duration: 30, features: ['All Pro features', 'Unlimited skills', 'Top rotation pool', 'Priority WhatsApp alerts', 'Verified badge'], maxSkills: 999, boostWeight: 10, isRotationEligible: true, isActive: true, sortOrder: 3, jobPostLimit: 0, jobApplyLimit: -1, jobNotification: true, badgeEnabled: true, priorityListing: true },
    { name: 'Free', slug: 'free', type: 'recruiter', price: 0, duration: 365, features: ['Basic access', '2 contact unlock / month'], unlockCredits: 2, isActive: true, sortOrder: 0, jobPostLimit: 2, jobApplyLimit: 0, jobNotification: false, badgeEnabled: false, priorityListing: false },
    { name: 'Starter Pack', slug: 'starter', type: 'recruiter', price: 999, duration: 30, features: ['25 contact unlocks', 'Extended search', 'Save favorites', '10 job posts/month'], unlockCredits: 25, isActive: true, sortOrder: 1, jobPostLimit: 10, jobApplyLimit: 0, jobNotification: true, badgeEnabled: false, priorityListing: false },
    { name: 'Business Pack', slug: 'business', type: 'recruiter', price: 2999, duration: 30, features: ['100 contact unlocks', 'Unlimited search', 'Priority support', 'Bulk actions', 'Unlimited job posts'], unlockCredits: 100, isActive: true, sortOrder: 2, jobPostLimit: -1, jobApplyLimit: 0, jobNotification: true, badgeEnabled: true, priorityListing: true },
    { name: 'Enterprise', slug: 'enterprise', type: 'recruiter', price: 9999, duration: 90, features: ['Unlimited unlocks', 'Unlimited search', 'Dedicated account manager', 'API access', 'Custom reports'], unlockCredits: 9999, isActive: true, sortOrder: 3, jobPostLimit: -1, jobApplyLimit: 0, jobNotification: true, badgeEnabled: true, priorityListing: true },
  ];

  const settings = [
    { key: 'free_skills_limit', value: 4, description: 'Max free skills for provider', category: 'limits' },
    { key: 'free_profile_view_limit', value: 10, description: 'Max free profile views for recruiter', category: 'limits' },
    { key: 'rotation_pool_size', value: 5, description: 'Max providers in rotation pool per skill+city', category: 'rotation' },
    { key: 'rotation_interval_sec', value: 60, description: 'Rotation interval in seconds', category: 'rotation' },
    { key: 'featured_limit', value: 5, description: 'Top featured providers displayed at once', category: 'rotation' },
    { key: 'profile_validity_days', value: 365, description: 'Profile active duration in days', category: 'general' },
  ];

  await Plan.insertMany(plans);
  await AdminSetting.insertMany(settings);

  return { plans: plans.length, settings: settings.length };
}

async function seedFreshState() {
  await connectDB();

  const preservedAdmins = await wipeDataKeepAdminUsers();
  const { providerUsers, recruiterUsers } = await seedUsersAndProfiles();
  const jobsCreated = await seedJobs(recruiterUsers);
  const { plans, settings } = await seedPlansAndSettings();

  console.log('\n--- Fresh Seed Complete ---');
  console.log(`Preserved admin accounts: ${preservedAdmins.length}`);
  preservedAdmins.forEach((a) => console.log(`- ${a.email}`));
  console.log(`Providers created: ${providerUsers.length}`);
  console.log(`Recruiters created: ${recruiterUsers.length}`);
  console.log(`Jobs created: ${jobsCreated}`);
  console.log(`Plans created: ${plans}`);
  console.log(`Admin settings created: ${settings}`);
  console.log('Sample provider login: rahul@test.com / test123');
  console.log('Sample recruiter login (approved): hr@techcorp.com / test123');
  console.log('Sample recruiter login (pending): hire@shopeasy.com / test123');

  process.exit(0);
}

seedFreshState().catch((err) => {
  console.error(err);
  process.exit(1);
});
