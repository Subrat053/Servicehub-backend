require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const RecruiterProfile = require('../models/RecruiterProfile');
const Plan = require('../models/Plan');
const AdminSetting = require('../models/AdminSetting');
const JobPost = require('../models/JobPost');

const connectDB = require('../config/db');

const seed = async () => {
  await connectDB();

  // Clear existing data
  await User.deleteMany({});
  await ProviderProfile.deleteMany({});
  await RecruiterProfile.deleteMany({});
  await Plan.deleteMany({});
  await AdminSetting.deleteMany({});

  console.log('Cleared existing data');

  // Create admin
  const admin = await User.create({
    name: 'Admin',
    email: 'admin@servicehub.com',
    password: 'admin123',
    role: 'admin',
    authProvider: 'email',
    isEmailVerified: true,
    termsAccepted: true,
  });
  console.log('Admin created:', admin.email);

  // Create sample providers
  const providerUsers = [];
  const providerData = [
    { name: 'Rahul Kumar', email: 'rahul@test.com', phone: '9876543210', skills: ['Driver', 'Delivery'], city: 'Delhi', experience: '5 years' },
    { name: 'Priya Sharma', email: 'priya@test.com', phone: '9876543211', skills: ['Tutor', 'Math Teacher'], city: 'Mumbai', experience: '3 years' },
    { name: 'Amit Patel', email: 'amit@test.com', phone: '9876543212', skills: ['Web Designer', 'Graphic Design'], city: 'Bangalore', experience: '4 years' },
    { name: 'Suman Devi', email: 'suman@test.com', phone: '9876543213', skills: ['Cook', 'Catering'], city: 'Delhi', experience: '8 years' },
    { name: 'Vikram Singh', email: 'vikram@test.com', phone: '9876543214', skills: ['Plumber', 'Electrician'], city: 'Jaipur', experience: '10 years' },
    { name: 'Neha Gupta', email: 'neha@test.com', phone: '9876543215', skills: ['Yoga Trainer', 'Fitness'], city: 'Mumbai', experience: '6 years' },
    { name: 'Ravi Verma', email: 'ravi@test.com', phone: '9876543216', skills: ['Driver', 'Mechanic'], city: 'Delhi', experience: '7 years' },
    { name: 'Anita Roy', email: 'anita@test.com', phone: '9876543217', skills: ['Tutor', 'English Teacher'], city: 'Kolkata', experience: '4 years' },
  ];

  for (const pd of providerData) {
    const user = await User.create({
      name: pd.name,
      email: pd.email,
      phone: pd.phone,
      password: 'test123',
      role: 'provider',
      authProvider: 'email',
      isEmailVerified: true,
      isPhoneVerified: true,
      termsAccepted: true,
    });

    await ProviderProfile.create({
      user: user._id,
      skills: pd.skills,
      experience: pd.experience,
      city: pd.city,
      languages: ['Hindi', 'English'],
      description: `Experienced ${pd.skills[0]} based in ${pd.city}. Available for immediate work.`,
      profileCompletion: 80,
      isApproved: true,
      isVerified: true,
      rating: Math.round((3 + Math.random() * 2) * 10) / 10,
      totalReviews: Math.floor(Math.random() * 20) + 1,
      profileExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    });

    providerUsers.push(user);
  }
  console.log(`${providerUsers.length} providers created`);

  // Create sample recruiters
  const recruiterData = [
    { name: 'TechCorp HR', email: 'hr@techcorp.com', phone: '9988776655', company: 'TechCorp Pvt Ltd', type: 'company', city: 'Bangalore' },
    { name: 'Ramesh Home', email: 'ramesh@test.com', phone: '9988776656', company: '', type: 'home', city: 'Delhi' },
    { name: 'ShopEasy', email: 'hire@shopeasy.com', phone: '9988776657', company: 'ShopEasy Store', type: 'shop', city: 'Mumbai' },
  ];

  const recruiterUsers = [];
  for (const rd of recruiterData) {
    const user = await User.create({
      name: rd.name,
      email: rd.email,
      phone: rd.phone,
      password: 'test123',
      role: 'recruiter',
      authProvider: 'email',
      isEmailVerified: true,
      termsAccepted: true,
    });

    await RecruiterProfile.create({
      user: user._id,
      companyName: rd.company,
      companyType: rd.type,
      city: rd.city,
      freeViewResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    recruiterUsers.push(user);
  }
  console.log(`${recruiterData.length} recruiters created`);

  // Create sample job posts for recruiters so providers can find recruiters
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
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    jobsCreated++;
  }
  console.log(`${jobsCreated} sample job posts created`);

  // Create plans (including free plans)
  const plans = [
    // Provider plans
    { name: 'Free', slug: 'free', type: 'provider', price: 0, duration: 365, features: ['Basic profile', 'Up to 4 skills'], maxSkills: 4, boostWeight: 0, isRotationEligible: false, isActive: true, sortOrder: 0, jobPostLimit: 0, jobApplyLimit: 5, jobNotification: false, badgeEnabled: false, priorityListing: false },
    { name: 'Basic Boost', slug: 'basic', type: 'provider', price: 2000, duration: 30, features: ['Profile boosted in search', 'Up to 6 skills', 'Priority listing'], maxSkills: 6, boostWeight: 2, isRotationEligible: false, isActive: true, sortOrder: 1, jobPostLimit: 0, jobApplyLimit: 20, jobNotification: true, badgeEnabled: false, priorityListing: false },
    { name: 'Pro Boost', slug: 'pro', type: 'provider', price: 5000, duration: 30, features: ['All Basic features', 'Up to 10 skills', 'Featured badge', 'WhatsApp lead alerts'], maxSkills: 10, boostWeight: 5, isRotationEligible: false, isActive: true, sortOrder: 2, jobPostLimit: 0, jobApplyLimit: -1, jobNotification: true, badgeEnabled: true, priorityListing: true },
    { name: 'Featured', slug: 'featured', type: 'provider', price: 10000, duration: 30, features: ['All Pro features', 'Unlimited skills', 'Top rotation pool', 'Priority WhatsApp alerts', 'Verified badge'], maxSkills: 999, boostWeight: 10, isRotationEligible: true, isActive: true, sortOrder: 3, jobPostLimit: 0, jobApplyLimit: -1, jobNotification: true, badgeEnabled: true, priorityListing: true },
    // Recruiter plans
    { name: 'Free', slug: 'free-recruiter', type: 'recruiter', price: 0, duration: 365, features: ['Basic access', '2 job posts/month'], unlockCredits: 0, isActive: true, sortOrder: 0, jobPostLimit: 2, jobApplyLimit: 0, jobNotification: false, badgeEnabled: false, priorityListing: false },
    { name: 'Starter Pack', slug: 'starter', type: 'recruiter', price: 999, duration: 30, features: ['25 contact unlocks', 'Extended search', 'Save favorites', '10 job posts/month'], unlockCredits: 25, isActive: true, sortOrder: 1, jobPostLimit: 10, jobApplyLimit: 0, jobNotification: true, badgeEnabled: false, priorityListing: false },
    { name: 'Business Pack', slug: 'business', type: 'recruiter', price: 2999, duration: 30, features: ['100 contact unlocks', 'Unlimited search', 'Priority support', 'Bulk actions', 'Unlimited job posts'], unlockCredits: 100, isActive: true, sortOrder: 2, jobPostLimit: -1, jobApplyLimit: 0, jobNotification: true, badgeEnabled: true, priorityListing: true },
    { name: 'Enterprise', slug: 'enterprise', type: 'recruiter', price: 9999, duration: 90, features: ['Unlimited unlocks', 'Unlimited search', 'Dedicated account manager', 'API access', 'Custom reports'], unlockCredits: 9999, isActive: true, sortOrder: 3, jobPostLimit: -1, jobApplyLimit: 0, jobNotification: true, badgeEnabled: true, priorityListing: true },
  ];

  for (const p of plans) {
    await Plan.create(p);
  }
  console.log(`${plans.length} plans created`);

  // Create admin settings
  const settings = [
    { key: 'free_skills_limit', value: 4, description: 'Max free skills for provider', category: 'limits' },
    { key: 'free_profile_view_limit', value: 10, description: 'Max free profile views for recruiter', category: 'limits' },
    { key: 'rotation_pool_size', value: 5, description: 'Max providers in rotation pool per skill+city', category: 'rotation' },
    { key: 'rotation_interval_sec', value: 60, description: 'Rotation interval in seconds', category: 'rotation' },
    { key: 'profile_validity_days', value: 365, description: 'Profile active duration in days', category: 'general' },
    { key: 'whatsapp_welcome_template', value: 'Hello {{name}}, Welcome to ServiceHub!', description: 'Welcome WhatsApp template', category: 'whatsapp' },
    { key: 'whatsapp_lead_template', value: 'Hi {{name}}, you have a new lead from {{recruiter}}!', description: 'New lead WhatsApp template', category: 'whatsapp' },
  ];

  for (const s of settings) {
    await AdminSetting.create(s);
  }
  console.log(`${settings.length} admin settings created`);

  console.log('\n--- Seed Complete ---');
  console.log('Admin: admin@servicehub.com / admin123');
  console.log('Provider: rahul@test.com / test123');
  console.log('Recruiter: hr@techcorp.com / test123');

  process.exit(0);
};

seed().catch(err => { console.error(err); process.exit(1); });
