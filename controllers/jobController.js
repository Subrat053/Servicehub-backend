const JobPost = require('../models/JobPost');
const Application = require('../models/Application');
const Lead = require('../models/Lead');
const { createNotification } = require('../services/notificationService');

// @desc    Browse available jobs (for providers)
// @route   GET /api/jobs?skill=&city=&page=&limit=
const getAvailableJobs = async (req, res) => {
  try {
    const { skill, city, page = 1, limit = 20 } = req.query;
    const filter = { status: 'active', expiresAt: { $gt: new Date() } };

    if (skill) filter.skill = { $regex: skill.trim(), $options: 'i' };
    if (city) filter.city = { $regex: city.trim(), $options: 'i' };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [jobs, total] = await Promise.all([
      JobPost.find(filter)
        .populate('recruiter', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      JobPost.countDocuments(filter),
    ]);

    // If provider is logged in, mark which jobs they've applied to
    if (req.user) {
      const jobIds = jobs.map(j => j._id);
      const applications = await Application.find({
        provider: req.user._id,
        jobPost: { $in: jobIds },
      }).select('jobPost').lean();
      const appliedSet = new Set(applications.map(a => a.jobPost.toString()));
      for (const job of jobs) {
        job.hasApplied = appliedSet.has(job._id.toString());
      }
    }

    res.json({
      jobs,
      pagination: { page: parseInt(page), limit: parseInt(limit), total, pages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Apply to a job (provider)
// @route   POST /api/jobs/:jobId/apply
const applyToJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { coverLetter } = req.body;

    const job = await JobPost.findById(jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (job.status !== 'active') return res.status(400).json({ message: 'This job is no longer active' });

    // Check duplicate application
    const existing = await Application.findOne({ jobPost: jobId, provider: req.user._id });
    if (existing) return res.status(400).json({ message: 'You have already applied to this job' });

    const application = await Application.create({
      jobPost: jobId,
      provider: req.user._id,
      coverLetter: coverLetter || '',
    });

    // Add provider to job's applicants array
    if (!job.applicants.includes(req.user._id)) {
      job.applicants.push(req.user._id);
      await job.save();
    }

    // Create a lead for the recruiter
    await Lead.create({
      provider: req.user._id,
      recruiter: job.recruiter,
      jobPost: job._id,
      type: 'job_match',
    });

    // Notify the recruiter
    await createNotification({
      userId: job.recruiter,
      type: 'NEW_LEAD',
      title: 'New Lead',
      message: 'You have a new lead',
      data: { jobId: job._id, applicationId: application._id, providerId: req.user._id },
    });

    res.status(201).json({ message: 'Application submitted', application });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get my applications (provider)
// @route   GET /api/jobs/my-applications
const getMyApplications = async (req, res) => {
  try {
    const applications = await Application.find({ provider: req.user._id })
      .populate({
        path: 'jobPost',
        select: 'title skill city budgetMin budgetMax budgetType status recruiter',
          populate: { path: 'recruiter', select: 'name email phone' },
      })
      .sort({ createdAt: -1 });
    res.json({ applications });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Get applications for my job (recruiter)
// @route   GET /api/jobs/:jobId/applications
const getJobApplications = async (req, res) => {
  try {
    const job = await JobPost.findById(req.params.jobId);
    if (!job) return res.status(404).json({ message: 'Job not found' });
    if (job.recruiter.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const applications = await Application.find({ jobPost: req.params.jobId })
      .populate('provider', 'name email avatar')
      .sort({ createdAt: -1 });
    res.json(applications);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Update application status (recruiter)
// @route   PUT /api/jobs/applications/:applicationId
const updateApplicationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const application = await Application.findById(req.params.applicationId).populate('jobPost', 'recruiter title');
    if (!application) return res.status(404).json({ message: 'Application not found' });

    if (application.jobPost.recruiter.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    application.status = status;
    await application.save();

    // Notify the provider about the status change
    await createNotification({
      userId: application.provider,
      type: 'ADMIN_ALERT',
      title: 'Application Update',
      message: `Your application for "${application.jobPost.title}" was ${status}`,
      data: { applicationId: application._id, status },
    });

    res.json({ message: 'Application updated', application });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

module.exports = {
  getAvailableJobs,
  applyToJob,
  getMyApplications,
  getJobApplications,
  updateApplicationStatus,
};
