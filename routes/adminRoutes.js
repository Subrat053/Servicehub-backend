const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getUsers,
  getUserDetail,
  toggleBlockUser,
  approveProvider,
  approveRecruiter,
  getProviders,
  getRecruiters,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan,
  getSettings,
  updateSettings,
  getRotationPools,
  updateRotationPool,
  getPayments,
  getAllJobs,
  getContent,
  updateContent,
  deleteUser,
  deleteProvider,
  deleteRecruiter,
  getPaymentSettings,
  updatePaymentSettings,
  getCurrencySettings,
  updateCurrencySettings,
  getCloudinarySettings,
  updateCloudinarySettings,
  getWhatsappLogs,
  getWhatsappSettings,
  updateWhatsappSettings,
  getSkillCategories,
  createSkillCategory,
  updateSkillCategory,
  addSkillToCategory,
  removeSkillFromCategory,
  deleteSkillCategory,
  uploadProfilePhoto,
  getProfilePhoto,
} = require('../controllers/adminController');
const upload = require('../middleware/upload');

// Admin content management (public for terms/privacy/faq display)
router.get('/content/:type', getContent);
router.put('/content/:type', require('../middleware/auth').protect, require('../middleware/auth').authorize('admin'), updateContent);

const { protect, authorize } = require('../middleware/auth');

// All admin routes below require admin role
router.use(protect, authorize('admin'));

router.get('/dashboard', getDashboard);
router.get('/users', getUsers);
router.get('/users/:id', getUserDetail);
router.put('/users/:id/block', toggleBlockUser);
router.delete('/users/:id', deleteUser);
router.put('/providers/:id/approve', approveProvider);
router.delete('/providers/:id', deleteProvider);
router.get('/providers', getProviders);
router.put('/recruiters/:id/approve', approveRecruiter);
router.delete('/recruiters/:id', deleteRecruiter);
router.get('/recruiters', getRecruiters);
router.get('/plans', getAllPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.get('/rotation-pools', getRotationPools);
router.put('/rotation-pools/:id', updateRotationPool);
router.get('/payments', getPayments);
router.get('/payment-settings', getPaymentSettings);
router.put('/payment-settings', updatePaymentSettings);
router.get('/currency-settings', getCurrencySettings);
router.put('/currency-settings', updateCurrencySettings);
router.get('/cloudinary-settings', getCloudinarySettings);
router.put('/cloudinary-settings', updateCloudinarySettings);
router.get('/whatsapp-logs', getWhatsappLogs);
router.get('/whatsapp-settings', getWhatsappSettings);
router.put('/whatsapp-settings', updateWhatsappSettings);
router.get('/jobs', getAllJobs);
router.post('/profile/photo', upload.single('profilePhoto'), uploadProfilePhoto);
router.get('/profile/photo', getProfilePhoto);

// Skill category management (admin)
router.get('/skills', getSkillCategories);
router.post('/skills', createSkillCategory);
router.put('/skills/:id', updateSkillCategory);
router.delete('/skills/:id', deleteSkillCategory);
router.post('/skills/:id/skills', addSkillToCategory);
router.delete('/skills/:id/skills/:skillId', removeSkillFromCategory);

module.exports = router;
