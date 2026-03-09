const multer = require('multer');
const path = require('path');

// Disk storage (fallback when Cloudinary is not configured)
const diskStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads/'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.round(Math.random()*1e9)}${ext}`);
  }
});

// Memory storage (for Cloudinary uploads)
const memoryStorage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') cb(null, true);
  else cb(new Error('Only image and PDF files are allowed!'), false);
};

// Default upload uses memory storage for Cloudinary
const upload = multer({
  storage: memoryStorage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Disk upload for fallback
const uploadDisk = multer({ storage: diskStorage, fileFilter });

module.exports = upload;
module.exports.uploadDisk = uploadDisk;
