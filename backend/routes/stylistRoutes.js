const express = require('express');
const router = express.Router();
const { recommendOutfit } = require('../controllers/aiStylistController');

// @route   POST /api/stylist/recommend
// @access  Public (no auth required to get a recommendation; cart/save
//          actions on the resulting items still go through the existing
//          protected cart/wishlist routes)
router.post('/recommend', recommendOutfit);

module.exports = router;
