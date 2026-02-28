const express = require('express');
const router = express.Router();
const {
  getDashboard,
  getUsers,
  toggleBlockUser,
  approveProvider,
  getProviders,
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
  getPaymentSettings,
  updatePaymentSettings,
  getSkillCategories,
  createSkillCategory,
  updateSkillCategory,
  addSkillToCategory,
  removeSkillFromCategory,
  deleteSkillCategory,
} = require('../controllers/adminController');
const upload = require('../middleware/upload');

// Admin content management
router.get('/content/:type', getContent); // type: terms, privacy, faq
router.put('/content/:type', updateContent);

const { protect, authorize } = require('../middleware/auth');

// All admin routes require admin role
router.use(protect, authorize('admin'));

router.get('/dashboard', getDashboard);
router.get('/users', getUsers);
router.put('/users/:id/block', toggleBlockUser);
router.delete('/users/:id', deleteUser);
router.put('/providers/:id/approve', approveProvider);
router.delete('/providers/:id', deleteProvider);
router.get('/providers', getProviders);
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
router.get('/jobs', getAllJobs);
router.post('/profile/photo', protect, authorize('admin'), upload.single('profilePhoto'), require('../controllers/adminController').uploadProfilePhoto);

// Skill category management (admin)
router.get('/skills', getSkillCategories);
router.post('/skills', createSkillCategory);
router.put('/skills/:id', updateSkillCategory);
router.delete('/skills/:id', deleteSkillCategory);
router.post('/skills/:id/skills', addSkillToCategory);
router.delete('/skills/:id/skills/:skillId', removeSkillFromCategory);

module.exports = router;
