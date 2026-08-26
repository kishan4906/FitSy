const { getAllProductsInternal } = require('./productController');
const { getOutfitRecommendation } = require('../services/aiStylistService');

const MAX_PROMPT_LENGTH = 400;
const MAX_CANDIDATES = 40;

// Fields sent to the AI model — deliberately narrow. Never send inventory
// counts, internal timestamps, image URLs, etc.
const toCandidateShape = (product) => ({
  id: String(product._id ?? product.id),
  name: product.name,
  category: product.category,
  price: product.price,
  description: product.description || '',
  tags: [product.badge, product.accent].filter(Boolean),
});

// Very small keyword-based occasion/color inference, used only to narrow the
// candidate set before it reaches the AI — the AI does the actual outfit
// reasoning. Kept intentionally simple per the "no ML recommender yet" plan.
const COLOR_WORDS = [
  'black', 'white', 'blue', 'red', 'green', 'grey', 'gray', 'beige',
  'navy', 'brown', 'pink', 'purple', 'yellow', 'orange', 'gold', 'silver',
  'denim', 'charcoal', 'olive', 'cream', 'tan', 'emerald', 'midnight',
];

function inferColorFromText(text) {
  const lower = text.toLowerCase();
  return COLOR_WORDS.find((color) => lower.includes(color)) || null;
}

function buildCandidateFilter({ prompt, occasion, style, color, budget }, allProducts) {
  const combinedText = [prompt, occasion, style, color].filter(Boolean).join(' ').toLowerCase();
  const inferredColor = color || inferColorFromText(combinedText);

  // Score rather than hard-filter, so a slightly-off attribute never zeroes
  // out the candidate pool entirely (the AI can still reason about fit).
  const scored = allProducts.map((product) => {
    let score = 0;
    const haystack = [
      product.name,
      product.category,
      product.description,
      product.badge,
      product.accent,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (inferredColor && haystack.includes(inferredColor)) score += 3;
    if (style && haystack.includes(String(style).toLowerCase())) score += 2;
    if (occasion && haystack.includes(String(occasion).toLowerCase())) score += 2;
    if (typeof budget === 'number' && budget > 0) {
      // Favor items comfortably within budget; still allow slightly-over items
      // so the AI has room to pick a valid combo.
      if (product.price <= budget) score += 2;
      else if (product.price <= budget * 1.5) score += 1;
    }
    // Small baseline so an empty/very generic prompt still returns a spread
    // across categories rather than only the highest-rated few.
    score += Math.min(Number(product.rating) || 0, 5) * 0.2;

    return { product, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Ensure category diversity within the candidate cap: take the top-scored
  // items but cap how many of any single category can dominate the list, so
  // the AI actually has tops AND bottoms AND shoes to choose from.
  const perCategoryCap = 8;
  const perCategoryCount = {};
  const selected = [];

  for (const { product } of scored) {
    const cat = product.category || 'Other';
    perCategoryCount[cat] = perCategoryCount[cat] || 0;
    if (perCategoryCount[cat] >= perCategoryCap) continue;
    perCategoryCount[cat] += 1;
    selected.push(product);
    if (selected.length >= MAX_CANDIDATES) break;
  }

  return selected;
}

/**
 * @desc    Generate an AI-recommended outfit from real catalog products
 * @route   POST /api/stylist/recommend
 * @access  Public
 */
const recommendOutfit = async (req, res) => {
  const { prompt = '', occasion, style, budget, color } = req.body || {};

  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ success: false, message: 'Please describe what you\'re looking for.' });
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return res.status(400).json({
      success: false,
      message: `Please keep your request under ${MAX_PROMPT_LENGTH} characters.`,
    });
  }

  const parsedBudget = budget !== undefined && budget !== null && budget !== '' ? Number(budget) : undefined;
  if (parsedBudget !== undefined && (Number.isNaN(parsedBudget) || parsedBudget < 0)) {
    return res.status(400).json({ success: false, message: 'Budget must be a positive number.' });
  }

  let allProducts;
  try {
    allProducts = await getAllProductsInternal();
  } catch (error) {
    console.error('[recommendOutfit] failed to load catalog:', error);
    return res.status(500).json({ success: false, message: 'Could not load the product catalog.' });
  }

  if (!allProducts || allProducts.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        outfitName: '',
        reason: 'The catalog is currently empty, so I have nothing to style from yet.',
        items: [],
        insufficientCatalog: true,
      },
    });
  }

  const candidates = buildCandidateFilter({ prompt, occasion, style, color, budget: parsedBudget }, allProducts);

  if (candidates.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        outfitName: '',
        reason: "I couldn't find any matching items for this request. Try loosening the budget or color preference.",
        items: [],
        insufficientCatalog: true,
      },
    });
  }

  const candidateShapes = candidates.map(toCandidateShape);
  const candidateById = new Map(candidateShapes.map((c) => [c.id, c]));

  let aiResult;
  try {
    aiResult = await getOutfitRecommendation(prompt, candidateShapes, { occasion, style, color, budget: parsedBudget });
  } catch (error) {
    console.error('[recommendOutfit] AI service error:', error.message);
    const status = error.code === 'AI_RATE_LIMITED' ? 429 : 503;
    return res.status(status).json({
      success: false,
      message:
        error.code === 'AI_RATE_LIMITED'
          ? 'The stylist is a little busy right now — please try again in a moment.'
          : 'The AI stylist is temporarily unavailable. Please try again shortly.',
    });
  }

  // Hard validation: only allow productIds that were actually in the
  // candidate set we sent. This is the line that prevents hallucinated
  // products from ever reaching the frontend, regardless of what the model
  // returned.
  const validatedItems = aiResult.items
    .filter((item) => candidateById.has(item.productId))
    .map((item) => {
      const candidate = candidateById.get(item.productId);
      const fullProduct = candidates.find((p) => String(p._id ?? p.id) === item.productId);
      return {
        productId: item.productId,
        name: candidate.name,
        price: candidate.price,
        image: fullProduct?.image || '',
        category: candidate.category,
        reason: item.reason,
      };
    });

  const totalPrice = validatedItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const overBudget = typeof parsedBudget === 'number' && parsedBudget > 0 && totalPrice > parsedBudget;

  return res.status(200).json({
    success: true,
    data: {
      outfitName: aiResult.outfitName,
      reason: aiResult.reason,
      items: validatedItems,
      totalPrice,
      overBudget,
      insufficientCatalog: aiResult.insufficientCatalog || validatedItems.length === 0,
    },
  });
};

module.exports = { recommendOutfit };
