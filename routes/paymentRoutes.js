const express = require('express');
const router = express.Router();
const {
  getPaymentPublicConfig,
  createOrder,
  verifyPayment,
  paymentFailed,
  getMyPayments,
  getPaymentById,
} = require('../controllers/paymentController');
const { protect } = require('../middleware/auth');

// NOTE: The Stripe webhook route is registered in server.js BEFORE
// express.json() so that Stripe's raw-body signature verification works.

// Protected routes
router.get('/config', protect, getPaymentPublicConfig);
router.post('/create-order', protect, createOrder);
router.post('/verify', protect, verifyPayment);
router.post('/failed', protect, paymentFailed);
router.get('/my-payments', protect, getMyPayments);
router.get('/:id', protect, getPaymentById);

module.exports = router;
