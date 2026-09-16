const express = require('express');
const router = express.Router();
const { getSizeRecommendation } = require('../controllers/sizeRecommendationController');

// @route   POST /api/size-recommendation
// @access  Public — no login required to get a one-off recommendation.
router.post('/', getSizeRecommendation);

module.exports = router;
