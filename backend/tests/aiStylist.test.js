// Tests for the AI Personal Stylist feature.
// Run with: node --test tests/aiStylist.test.js
//
// These test the controller's validation/business logic in isolation by
// mocking the two things it depends on (the catalog fetch and the AI call)
// via Node's built-in module cache — no real DB or network calls.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const PRODUCT_CONTROLLER_PATH = path.join(__dirname, '../controllers/productController.js');
const AI_SERVICE_PATH = path.join(__dirname, '../services/aiStylistService.js');
const AI_CONTROLLER_PATH = path.join(__dirname, '../controllers/aiStylistController.js');

const SAMPLE_CATALOG = [
  { _id: 'p1', name: 'Black Oversized Shirt', category: 'Tops', price: 999, rating: 4.5, description: 'Black tee' },
  { _id: 'p2', name: 'Black Straight Jeans', category: 'Bottoms', price: 1299, rating: 4.5, description: 'Black jeans' },
  { _id: 'p3', name: 'White Sneakers', category: 'Shoes', price: 799, rating: 4.5, description: 'White sneakers' },
];

// Fresh require of the controller with mocked dependencies swapped into
// Node's require cache before the controller (and its deps) are loaded.
function loadControllerWith({ catalog, aiImpl }) {
  delete require.cache[require.resolve(AI_CONTROLLER_PATH)];
  delete require.cache[require.resolve(PRODUCT_CONTROLLER_PATH)];
  delete require.cache[require.resolve(AI_SERVICE_PATH)];

  require.cache[require.resolve(PRODUCT_CONTROLLER_PATH)] = {
    id: require.resolve(PRODUCT_CONTROLLER_PATH),
    filename: require.resolve(PRODUCT_CONTROLLER_PATH),
    loaded: true,
    exports: {
      getAllProductsInternal: async () => catalog,
    },
  };

  require.cache[require.resolve(AI_SERVICE_PATH)] = {
    id: require.resolve(AI_SERVICE_PATH),
    filename: require.resolve(AI_SERVICE_PATH),
    loaded: true,
    exports: {
      getOutfitRecommendation: aiImpl,
    },
  };

  return require(AI_CONTROLLER_PATH);
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('rejects a request with no prompt', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: SAMPLE_CATALOG,
    aiImpl: async () => ({ outfitName: '', reason: '', items: [], insufficientCatalog: false }),
  });
  const res = mockRes();
  await recommendOutfit({ body: { prompt: '   ' } }, res);
  assert.equal(res.statusCode, 400);
});

test('validates AI-returned productIds against the real candidate set', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: SAMPLE_CATALOG,
    aiImpl: async () => ({
      outfitName: 'Smart Black Casual',
      reason: 'Because black.',
      items: [
        { productId: 'p1', reason: 'top' },
        { productId: 'p2', reason: 'bottom' },
        { productId: 'HALLUCINATED_ID', reason: 'should be dropped' },
      ],
      insufficientCatalog: false,
    }),
  });
  const res = mockRes();
  await recommendOutfit({ body: { prompt: 'college farewell, black, under 3000' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  const ids = res.body.data.items.map((i) => i.productId);
  assert.deepEqual(ids.sort(), ['p1', 'p2']);
  assert.ok(!ids.includes('HALLUCINATED_ID'));
});

test('AI cannot recommend products outside the retrieved candidate set even if all ids are hallucinated', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: SAMPLE_CATALOG,
    aiImpl: async () => ({
      outfitName: 'Fake outfit',
      reason: 'n/a',
      items: [{ productId: 'does-not-exist', reason: 'n/a' }],
      insufficientCatalog: false,
    }),
  });
  const res = mockRes();
  await recommendOutfit({ body: { prompt: 'anything' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.items.length, 0);
  assert.equal(res.body.data.insufficientCatalog, true);
});

test('handles an empty catalog gracefully', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: [],
    aiImpl: async () => ({ outfitName: '', reason: '', items: [], insufficientCatalog: false }),
  });
  const res = mockRes();
  await recommendOutfit({ body: { prompt: 'anything' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.items.length, 0);
  assert.equal(res.body.data.insufficientCatalog, true);
});

test('handles malformed AI output (thrown AI_MALFORMED error) without crashing', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: SAMPLE_CATALOG,
    aiImpl: async () => {
      const err = new Error('AI stylist returned malformed JSON.');
      err.code = 'AI_MALFORMED';
      throw err;
    },
  });
  const res = mockRes();
  await recommendOutfit({ body: { prompt: 'anything' } }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, false);
});

test('flags an outfit that exceeds the stated budget rather than silently hiding it', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: SAMPLE_CATALOG,
    aiImpl: async () => ({
      outfitName: 'Over Budget Fit',
      reason: 'closest match',
      items: [
        { productId: 'p1', reason: 'top' },
        { productId: 'p2', reason: 'bottom' },
        { productId: 'p3', reason: 'shoes' },
      ],
      insufficientCatalog: false,
    }),
  });
  const res = mockRes();
  // total is 999 + 1299 + 799 = 3097, budget below that
  await recommendOutfit({ body: { prompt: 'farewell outfit', budget: 3000 } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.totalPrice, 3097);
  assert.equal(res.body.data.overBudget, true);
});

test('rejects a negative or non-numeric budget', async () => {
  const { recommendOutfit } = loadControllerWith({
    catalog: SAMPLE_CATALOG,
    aiImpl: async () => ({ outfitName: '', reason: '', items: [], insufficientCatalog: false }),
  });
  const res = mockRes();
  await recommendOutfit({ body: { prompt: 'anything', budget: 'not-a-number' } }, res);
  assert.equal(res.statusCode, 400);
});
