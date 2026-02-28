const mongoose = require('mongoose');

const skillSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, trim: true, lowercase: true },
  isActive: { type: Boolean, default: true },
}, { _id: true });

const skillCategorySchema = new mongoose.Schema({
  tier: {
    type: String,
    enum: ['unskilled', 'semi-skilled', 'skilled'],
    required: true,
  },
  name: { type: String, required: true, trim: true },           // e.g. "Home / Personal"
  icon: { type: String, default: '🔧' },
  slug: { type: String, required: true, trim: true, lowercase: true },
  skills: [skillSchema],
  sortOrder: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

skillCategorySchema.index({ tier: 1, slug: 1 }, { unique: true });

module.exports = mongoose.model('SkillCategory', skillCategorySchema);
