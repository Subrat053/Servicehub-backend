const Notification = require('../models/Notification');
const UserSubscription = require('../models/UserSubscription');
const ProviderProfile = require('../models/ProviderProfile');

// Socket.io instance (set from server.js)
let io = null;

function setIO(socketIO) {
  io = socketIO;
}

function getIO() {
  return io;
}

const emitNotificationToUser = async (userId, notification) => {
  if (!io) return;

  const userRoom = `user_${userId}`;
  const payload = {
    _id: notification._id,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data || {},
    isRead: notification.isRead,
    createdAt: notification.createdAt,
  };

  io.to(userRoom).emit('new_notification', payload);
  // Backward compatibility for any existing listeners.
  io.to(userRoom).emit('notification', payload);

  const unreadCount = await Notification.countDocuments({ userId, isRead: false });
  io.to(userRoom).emit('unread_count', { unreadCount });
};

/**
 * Create an in-app notification and emit via socket.io if connected.
 */
async function createNotification({ userId, type, title, message, data = {} }) {
  const notification = await Notification.create({
    userId,
    type,
    title,
    message,
    data,
  });

  await emitNotificationToUser(userId, notification);

  return notification;
}

async function createBulkNotifications(userIds, payload) {
  const uniqueUserIds = [...new Set((userIds || []).map(String))];
  if (uniqueUserIds.length === 0) return [];

  const docs = uniqueUserIds.map((id) => ({
    userId: id,
    type: payload.type,
    title: payload.title,
    message: payload.message,
    data: payload.data || {},
  }));

  const notifications = await Notification.insertMany(docs, { ordered: false });

  if (io) {
    await Promise.all(notifications.map((notification) => emitNotificationToUser(notification.userId.toString(), notification)));
  }

  return notifications;
}

/**
 * Notify eligible providers when a new job is posted.
 * Filters by skill + city and only provider users with active subscriptions.
 */
async function notifyProvidersOfNewJob(job, matchedProviderUserIds = []) {
  if (Array.isArray(matchedProviderUserIds) && matchedProviderUserIds.length > 0) {
    const userIds = [...new Set(matchedProviderUserIds.map(String))];
    await createBulkNotifications(userIds, {
      type: 'JOB_POSTED',
      title: 'New Job Posted',
      message: 'A new job matching your skills is available',
      data: { jobId: job._id, skill: job.skill, city: job.city },
    });
    return userIds;
  }

  const now = new Date();
  const activeSubs = await UserSubscription.find({
    status: 'active',
    endDate: { $gt: now },
  }).populate('planId userId');

  const eligibleProviderUserIds = activeSubs
    .filter((sub) => sub.planId && sub.userId && sub.userId.role === 'provider' && sub.planId.jobNotification)
    .map((sub) => sub.userId._id.toString());

  if (eligibleProviderUserIds.length === 0) return [];

  const matchedProviders = await ProviderProfile.find({
    user: { $in: eligibleProviderUserIds },
    skills: { $regex: job.skill, $options: 'i' },
    city: { $regex: `^${String(job.city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' },
    isApproved: true,
  }).select('user');

  const recipientUserIds = matchedProviders.map((p) => p.user.toString());
  if (recipientUserIds.length === 0) return [];

  await createBulkNotifications(recipientUserIds, {
    type: 'JOB_POSTED',
    title: 'New Job Posted',
    message: 'A new job matching your skills is available',
    data: { jobId: job._id, skill: job.skill, city: job.city },
  });

  return recipientUserIds;
}

module.exports = {
  setIO,
  getIO,
  createNotification,
  createBulkNotifications,
  notifyProvidersOfNewJob,
};
