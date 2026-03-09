const AdminSetting = require('../models/AdminSetting');

/**
 * Get Cloudinary configuration from AdminSettings DB
 * Falls back to environment variables
 */
const getCloudinaryConfig = async () => {
  const settings = await AdminSetting.find({ category: 'cloudinary' });
  const config = {};
  settings.forEach(s => { config[s.key] = s.value; });

  return {
    cloudName: config.cloudinary_cloud_name || process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: config.cloudinary_api_key || process.env.CLOUDINARY_API_KEY || '',
    apiSecret: config.cloudinary_api_secret || process.env.CLOUDINARY_API_SECRET || '',
  };
};

/**
 * Get a configured cloudinary instance
 */
const getCloudinaryInstance = async () => {
  const cloudinary = require('cloudinary').v2;
  const config = await getCloudinaryConfig();

  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    throw new Error('Cloudinary not configured. Set credentials in Admin → Settings or .env');
  }

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
  });

  return cloudinary;
};

/**
 * Upload a buffer/file to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer
 * @param {Object} options - Upload options (folder, public_id, etc.)
 * @returns {Promise<Object>} Cloudinary upload result
 */
const uploadToCloudinary = async (fileBuffer, options = {}) => {
  const cloudinary = await getCloudinaryInstance();

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder || 'servicehub',
        resource_type: options.resource_type || 'auto',
        public_id: options.public_id || undefined,
        transformation: options.transformation || [
          { width: 800, height: 800, crop: 'limit', quality: 'auto:good' },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    uploadStream.end(fileBuffer);
  });
};

/**
 * Delete a file from Cloudinary by public_id or URL
 * @param {string} urlOrPublicId - Cloudinary URL or public_id
 */
const deleteFromCloudinary = async (urlOrPublicId) => {
  if (!urlOrPublicId) return;
  const cloudinary = await getCloudinaryInstance();

  let publicId = urlOrPublicId;
  // Extract public_id from URL
  if (urlOrPublicId.includes('cloudinary.com')) {
    const parts = urlOrPublicId.split('/');
    const uploadIdx = parts.indexOf('upload');
    if (uploadIdx !== -1) {
      // Skip version (e.g., v1234567890)
      const pathAfterUpload = parts.slice(uploadIdx + 1);
      if (pathAfterUpload[0] && pathAfterUpload[0].startsWith('v')) {
        pathAfterUpload.shift();
      }
      publicId = pathAfterUpload.join('/').replace(/\.[^/.]+$/, '');
    }
  }

  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('[Cloudinary Delete Error]', err.message);
  }
};

module.exports = { getCloudinaryConfig, getCloudinaryInstance, uploadToCloudinary, deleteFromCloudinary };
