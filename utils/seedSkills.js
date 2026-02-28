/**
 * Seed script: node utils/seedSkills.js
 * Populates the SkillCategory collection with all tiers.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const SkillCategory = require('../models/SkillCategory');

const toSlug = (str) => str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
const toSkill = (name) => ({ name, slug: toSlug(name), isActive: true });

const categories = [
  // ─── UNSKILLED ────────────────────────────────────────
  {
    tier: 'unskilled', icon: '🏠', name: 'Home / Personal', slug: 'home-personal',
    skills: ['House helper / Maid','Cleaning staff','Dishwasher','Kitchen helper','Babysitting assistant','Elder care helper','Pet helper'].map(toSkill),
  },
  {
    tier: 'unskilled', icon: '🚚', name: 'Transport / Delivery', slug: 'transport-delivery',
    skills: ['Delivery boy','Courier runner','Warehouse loader','Packing staff','Mover / Shifter'].map(toSkill),
  },
  {
    tier: 'unskilled', icon: '🏗', name: 'Construction', slug: 'construction',
    skills: ['Construction helper','Site labour','Brick carrier','Road worker'].map(toSkill),
  },
  {
    tier: 'unskilled', icon: '🏭', name: 'Factory / Industrial', slug: 'factory-industrial',
    skills: ['Factory worker','Assembly worker','Sorting staff','Helper'].map(toSkill),
  },
  {
    tier: 'unskilled', icon: '🏬', name: 'Retail / Shop', slug: 'retail-shop',
    skills: ['Shop helper','Store assistant','Stock handler','Sales helper'].map(toSkill),
  },
  {
    tier: 'unskilled', icon: '🏢', name: 'Office Support', slug: 'office-support-unskilled',
    skills: ['Office boy','Tea boy','Cleaner'].map(toSkill),
  },
  // ─── SEMI-SKILLED ─────────────────────────────────────
  {
    tier: 'semi-skilled', icon: '🔧', name: 'Technical Field', slug: 'technical-field',
    skills: ['Electrician','Plumber','Carpenter','AC technician','Painter','Welder','Mechanic','CCTV installer'].map(toSkill),
  },
  {
    tier: 'semi-skilled', icon: '🚗', name: 'Transport', slug: 'transport-semi',
    skills: ['Driver (Car)','Truck driver','Bus driver','Forklift operator'].map(toSkill),
  },
  {
    tier: 'semi-skilled', icon: '🍳', name: 'Hospitality', slug: 'hospitality',
    skills: ['Cook','Chef assistant','Waiter','Bartender'].map(toSkill),
  },
  {
    tier: 'semi-skilled', icon: '💄', name: 'Beauty & Personal Care', slug: 'beauty-personal-care',
    skills: ['Beautician','Hair stylist','Nail artist','Massage therapist'].map(toSkill),
  },
  {
    tier: 'semi-skilled', icon: '📞', name: 'Office / Sales', slug: 'office-sales',
    skills: ['Telecaller','Customer support','Field sales executive','Collection executive'].map(toSkill),
  },
  {
    tier: 'semi-skilled', icon: '🏥', name: 'Healthcare (Semi)', slug: 'healthcare-semi',
    skills: ['Nurse assistant','Caretaker','Lab technician'].map(toSkill),
  },
  // ─── SKILLED / PROFESSIONAL ───────────────────────────
  {
    tier: 'skilled', icon: '💻', name: 'Tech & Digital', slug: 'tech-digital',
    skills: ['Software developer','App developer','Web developer','AI specialist','Data analyst','UI/UX designer','Graphic designer','Video editor','SEO expert','Digital marketer'].map(toSkill),
  },
  {
    tier: 'skilled', icon: '📊', name: 'Finance & Legal', slug: 'finance-legal',
    skills: ['Chartered Accountant','Accountant','Tax consultant','Lawyer','Legal advisor'].map(toSkill),
  },
  {
    tier: 'skilled', icon: '🏗', name: 'Engineering', slug: 'engineering',
    skills: ['Civil engineer','Mechanical engineer','Electrical engineer','Architect','Interior designer'].map(toSkill),
  },
  {
    tier: 'skilled', icon: '🏫', name: 'Education', slug: 'education',
    skills: ['School teacher','Online tutor','Coding teacher','Music teacher','Language trainer'].map(toSkill),
  },
  {
    tier: 'skilled', icon: '🏥', name: 'Medical', slug: 'medical',
    skills: ['Doctor','Physiotherapist','Therapist','Psychologist','Dietician'].map(toSkill),
  },
  {
    tier: 'skilled', icon: '🏢', name: 'Corporate & Remote', slug: 'corporate-remote',
    skills: ['HR manager','Project manager','Business consultant','Operations manager','Virtual assistant','Remote developer','Remote designer','Remote customer support','Freelance writer','Remote video editor'].map(toSkill),
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // Upsert each category (preserve existing custom skills)
  for (const cat of categories) {
    await SkillCategory.findOneAndUpdate(
      { tier: cat.tier, slug: cat.slug },
      { $setOnInsert: cat },
      { upsert: true, new: true }
    );
  }

  console.log(`✅ Seeded ${categories.length} skill categories`);
  await mongoose.disconnect();
}

seed().catch((err) => { console.error(err); process.exit(1); });
