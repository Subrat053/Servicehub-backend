require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Review = require('../models/Review');
const Lead = require('../models/Lead');

const shouldWrite = process.argv.includes('--write');

const resolveLeadId = async (providerId, recruiterId, reviewCreatedAt) => {
  if (!providerId || !recruiterId) return null;

  const baseQuery = {
    provider: providerId,
    recruiter: recruiterId,
    $or: [
      { isUnlocked: true },
      { status: { $in: ['contacted', 'hired', 'rejected'] } },
      { type: { $in: ['contact_unlock', 'direct_contact'] } },
    ],
  };

  // Prefer an interaction that existed at or before review creation time.
  const timed = await Lead.findOne({
    ...baseQuery,
    createdAt: { $lte: reviewCreatedAt },
  })
    .sort({ createdAt: -1 })
    .select('_id')
    .lean();

  if (timed?._id) return timed._id;

  const latest = await Lead.findOne(baseQuery)
    .sort({ createdAt: -1 })
    .select('_id')
    .lean();

  return latest?._id || null;
};

const run = async () => {
  await connectDB();

  const query = {
    $or: [
      { reviewerId: { $exists: false } },
      { reviewerId: null },
      { revieweeId: { $exists: false } },
      { revieweeId: null },
      { leadId: { $exists: false } },
      { leadId: null },
    ],
  };

  const candidates = await Review.find(query)
    .select('_id reviewerId revieweeId leadId recruiter provider createdAt')
    .lean();

  if (!candidates.length) {
    console.log('No review documents require migration.');
    await mongoose.disconnect();
    return;
  }

  const ops = [];
  let counters = {
    reviewerId: 0,
    revieweeId: 0,
    leadId: 0,
    skippedNoPair: 0,
  };

  for (const doc of candidates) {
    const set = {};

    if (!doc.reviewerId && doc.recruiter) {
      set.reviewerId = doc.recruiter;
      counters.reviewerId += 1;
    }

    if (!doc.revieweeId && doc.provider) {
      set.revieweeId = doc.provider;
      counters.revieweeId += 1;
    }

    const providerId = set.revieweeId || doc.revieweeId || doc.provider;
    const recruiterId = set.reviewerId || doc.reviewerId || doc.recruiter;

    if (!doc.leadId) {
      if (providerId && recruiterId) {
        const resolvedLeadId = await resolveLeadId(providerId, recruiterId, doc.createdAt);
        if (resolvedLeadId) {
          set.leadId = resolvedLeadId;
          counters.leadId += 1;
        }
      } else {
        counters.skippedNoPair += 1;
      }
    }

    if (Object.keys(set).length) {
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: set },
        },
      });
    }
  }

  console.log(`Found ${candidates.length} candidate review(s).`);
  console.log(`Prepared ${ops.length} update operation(s).`);
  console.log('Backfill summary:', counters);

  if (!shouldWrite) {
    console.log('Dry run only. Re-run with --write to apply changes.');
    await mongoose.disconnect();
    return;
  }

  if (!ops.length) {
    console.log('No updates to apply.');
    await mongoose.disconnect();
    return;
  }

  const result = await Review.bulkWrite(ops, { ordered: false });
  console.log('Migration applied.', {
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  });

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('Review migration failed:', error.message);
  await mongoose.disconnect();
  process.exit(1);
});
