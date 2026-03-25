const express = require('express');
const { autocompleteLocation, nearbyLocations } = require('../controllers/locationController');

const router = express.Router();

router.post('/autocomplete', autocompleteLocation);
router.post('/nearby', nearbyLocations);

module.exports = router;
