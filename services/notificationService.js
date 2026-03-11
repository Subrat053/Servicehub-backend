const Notification = require('../models/Notification');
const UserSubscription = require('../models/UserSubscription');
const { sendWhatsAppMessage } = require('../utils/messaging');

// Socket.io instance (set from server.js)
let io = null;

function setIO(socketIO) {
  io = socketIO;
}

function getIO() {
  return io;
}

/**
 * Create an in-app notification and emit via socket.io if connected.
 */
async function createNotification({ userId, type, title, message, metadata = {} }) {
  const notification = await Notification.create({ user: userId, type, title, message, metadata });

  // Emit real-time event if socket.io is available
  if (io) {
    io.to(`user_${userId}`).emit('notification', {
      _id: notification._id,
      type,
      title,
      message,
      metadata,
      createdAt: notification.createdAt,
    });
  }

  return notification;
}

/**
 * Notify eligible providers when a new job is posted.
 * Only providers whose plan has jobNotification = true receive notifications.
 */
async function notifyProvidersOfNewJob(job) {
  const now = new Date();

  // Find all active subscriptions with plans that have jobNotification enabled
  const activeSubs = await UserSubscription.find({
    status: 'active',
    endDate: { $gt: now },
  }).populate('planId userId');

  const notified = [];

  for (const sub of activeSubs) {
    if (!sub.planId || !sub.userId) continue;
    if (!sub.planId.jobNotification) continue;
    if (sub.userId.role !== 'provider') continue;

    // Create in-app notification
    await createNotification({
      userId: sub.userId._id,
      type: 'new_job',
      title: 'New Job Posted',
      message: `New job: "${job.title}" in ${job.city}`,
      metadata: { jobId: job._id, skill: job.skill, city: job.city },
    });

    notified.push(sub.userId._id);
  }

  // Emit global new-job event for real-time alerts
  if (io) {
    io.emit('new-job', {
      _id: job._id,
      title: job.title,
      skill: job.skill,
      city: job.city,
    });
  }

  return notified;
}

module.exports = { setIO, getIO, createNotification, notifyProvidersOfNewJob };
