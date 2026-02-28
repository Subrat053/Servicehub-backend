const express = require('express');
const router = express.Router();
const Faq = require('../models/Faq');

// Get all FAQs
router.get('/', async (req, res) => {
  try {
    const faqs = await Faq.find({ isActive: true });
    res.json(faqs);
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
});

// Add FAQ
router.post('/', async (req, res) => {
  try {
    const { question, answer, category } = req.body;
    const faq = await Faq.create({ question, answer, category });
    res.status(201).json(faq);
  } catch (err) {
    res.status(400).json({ message: 'Error creating FAQ', error: err.message });
  }
});

// Update FAQ
router.put('/:id', async (req, res) => {
  try {
    const { question, answer, category, isActive } = req.body;
    const faq = await Faq.findByIdAndUpdate(req.params.id, { question, answer, category, isActive }, { new: true });
    res.json(faq);
  } catch (err) {
    res.status(400).json({ message: 'Error updating FAQ', error: err.message });
  }
});

// Delete FAQ
router.delete('/:id', async (req, res) => {
  try {
    await Faq.findByIdAndDelete(req.params.id);
    res.json({ message: 'FAQ deleted' });
  } catch (err) {
    res.status(400).json({ message: 'Error deleting FAQ', error: err.message });
  }
});

module.exports = router;
