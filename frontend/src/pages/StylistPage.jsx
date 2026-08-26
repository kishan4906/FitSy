import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Heart, ShoppingBag, Wand2, AlertCircle } from 'lucide-react';
import * as api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useProducts } from '../context/ProductsContext';
import { useStore } from '../context/StoreContext';
import ProductImage from '../components/ProductImage';
import GarmentTryOn from '../components/GarmentTryOn';

const OCCASIONS = ['College', 'Casual', 'Formal', 'Party', 'Date'];
const STYLES = ['Casual', 'Streetwear', 'Minimal', 'Formal'];

export default function StylistPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { getProductById } = useProducts();
  const { addToCart, toggleWishlist, wishlistItems } = useStore();

  const [prompt, setPrompt] = useState('');
  const [occasion, setOccasion] = useState('');
  const [style, setStyle] = useState('');
  const [budget, setBudget] = useState('');
  const [color, setColor] = useState('');

  // idle | loading | success | error
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [outfit, setOutfit] = useState(null);
  const [savedOutfit, setSavedOutfit] = useState(false);
  const [addedToCart, setAddedToCart] = useState(false);
  const [tryOnProduct, setTryOnProduct] = useState(null);

  async function handleGenerate(event) {
    event.preventDefault();
    if (!prompt.trim()) return;

    setStatus('loading');
    setErrorMessage('');
    setOutfit(null);
    setSavedOutfit(false);
    setAddedToCart(false);

    const { data, error } = await api.stylist.recommend({
      prompt: prompt.trim(),
      occasion: occasion || undefined,
      style: style || undefined,
      budget: budget ? Number(budget) : undefined,
      color: color || undefined,
    });

    if (error || !data?.success) {
      setStatus('error');
      setErrorMessage(error || data?.message || 'Something went wrong. Please try again.');
      return;
    }

    setOutfit(data.data);
    setStatus('success');
  }

  // Hydrate each trimmed outfit item back into a full product object from
  // the client-side catalog, so cart/wishlist/try-on get everything they
  // expect (sizes, vtoType, etc.) — not just the fields the AI response has.
  const hydratedItems = (outfit?.items || [])
    .map((item) => {
      const fullProduct = getProductById(item.productId);
      return fullProduct ? { ...fullProduct, stylistReason: item.reason } : null;
    })
    .filter(Boolean);

  function requireAuth() {
    if (!isAuthenticated) {
      navigate('/auth');
      return false;
    }
    return true;
  }

  async function handleAddOutfitToCart() {
    if (!requireAuth() || hydratedItems.length === 0) return;
    for (const product of hydratedItems) {
      // eslint-disable-next-line no-await-in-loop
      await addToCart({ product, size: product.sizes?.[0] || 'M' });
    }
    setAddedToCart(true);
  }

  async function handleSaveOutfit() {
    if (!requireAuth() || hydratedItems.length === 0) return;
    for (const product of hydratedItems) {
      const alreadySaved = wishlistItems.some((w) => w.productId === (product.id || product._id));
      if (!alreadySaved) {
        // eslint-disable-next-line no-await-in-loop
        await toggleWishlist({ product });
      }
    }
    setSavedOutfit(true);
  }

  function handleTryOutfit() {
    // VTON in this app only supports one garment at a time, so we open the
    // existing try-on flow for the outfit's top (or first item if no
    // upper-body piece was picked). Multi-item try-on is a future feature.
    const primary =
      hydratedItems.find((p) => p.vtoType === 'upper-body') || hydratedItems[0];
    if (primary) setTryOnProduct(primary);
  }

  return (
    <div className="max-w-container-max mx-auto px-4 md:px-margin-desktop py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 text-primary text-sm font-semibold mb-2">
          <Sparkles className="w-4 h-4" />
          AI PERSONAL STYLIST
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-on-surface">Tell me what you're looking for</h1>
      </div>

      <form
        onSubmit={handleGenerate}
        className="max-w-2xl mx-auto bg-surface-container rounded-2xl border border-outline-variant/40 p-6 shadow-sm space-y-5"
      >
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="I'm going to a college farewell. I want something stylish and mostly black, under $60."
          rows={3}
          maxLength={400}
          className="w-full rounded-xl border border-outline-variant/50 bg-surface px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-semibold text-on-surface-variant mb-1 block">Occasion</label>
            <select
              value={occasion}
              onChange={(e) => setOccasion(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/50 bg-surface px-3 py-2 text-sm text-on-surface"
            >
              <option value="">Any</option>
              {OCCASIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-variant mb-1 block">Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full rounded-lg border border-outline-variant/50 bg-surface px-3 py-2 text-sm text-on-surface"
            >
              <option value="">Any</option>
              {STYLES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-variant mb-1 block">Budget ($)</label>
            <input
              type="number"
              min="0"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="e.g. 300"
              className="w-full rounded-lg border border-outline-variant/50 bg-surface px-3 py-2 text-sm text-on-surface"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-on-surface-variant mb-1 block">Color</label>
            <input
              type="text"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. black"
              className="w-full rounded-lg border border-outline-variant/50 bg-surface px-3 py-2 text-sm text-on-surface"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={status === 'loading' || !prompt.trim()}
          className="w-full flex items-center justify-center gap-2 bg-primary text-white font-semibold rounded-full py-3 text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Wand2 className="w-4 h-4" />
          {status === 'loading' ? 'Styling your outfit…' : 'Generate Outfit'}
        </button>
      </form>

      {/* ── States ─────────────────────────────────────────────────────── */}
      <div className="max-w-2xl mx-auto mt-8">
        {status === 'error' && (
          <div className="flex items-start gap-3 bg-error-container/20 border border-error/30 text-on-surface rounded-xl p-4 text-sm">
            <AlertCircle className="w-5 h-5 text-error shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold mb-1">Couldn't generate an outfit</p>
              <p className="text-on-surface-variant">{errorMessage}</p>
            </div>
          </div>
        )}

        {status === 'success' && outfit && (
          <div>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-on-surface mb-2">
                {outfit.outfitName || 'Your AI-Recommended Outfit'}
              </h2>
              {outfit.reason && (
                <p className="text-sm text-on-surface-variant italic max-w-lg mx-auto">"{outfit.reason}"</p>
              )}
            </div>

            {outfit.overBudget && (
              <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 text-on-surface text-xs rounded-lg px-3 py-2 mb-4">
                <AlertCircle className="w-4 h-4 text-primary shrink-0" />
                This is the closest match — it comes in slightly over your budget.
              </div>
            )}

            {hydratedItems.length === 0 ? (
              <div className="text-center text-sm text-on-surface-variant bg-surface-container rounded-xl p-6">
                I couldn't find enough matching items within your preferences. Try loosening the budget or color.
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {hydratedItems.map((product) => (
                    <div
                      key={product.id || product._id}
                      className="flex items-center gap-4 bg-surface-container border border-outline-variant/40 rounded-xl p-3"
                    >
                      <ProductImage
                        product={product}
                        src={product.image}
                        alt={product.name}
                        className="w-16 h-16 rounded-lg object-cover shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-on-surface truncate">{product.name}</p>
                        <p className="text-xs text-on-surface-variant">${Number(product.price).toFixed(2)}</p>
                        {product.stylistReason && (
                          <p className="text-xs text-primary/80 mt-0.5">{product.stylistReason}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/product/${product.id || product._id}`)}
                        className="text-xs font-semibold text-primary shrink-0 hover:underline"
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center justify-between mt-4 px-1">
                  <span className="text-sm font-semibold text-on-surface-variant">Total</span>
                  <span className="text-lg font-bold text-primary">${Number(outfit.totalPrice || 0).toFixed(2)}</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
                  <button
                    type="button"
                    onClick={handleSaveOutfit}
                    className="flex items-center justify-center gap-2 border border-outline-variant/50 rounded-full py-2.5 text-sm font-semibold text-on-surface hover:bg-surface-container transition-colors"
                  >
                    <Heart className={`w-4 h-4 ${savedOutfit ? 'fill-primary text-primary' : ''}`} />
                    {savedOutfit ? 'Saved' : 'Save Outfit'}
                  </button>
                  <button
                    type="button"
                    onClick={handleAddOutfitToCart}
                    className="flex items-center justify-center gap-2 bg-primary text-white rounded-full py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    {addedToCart ? 'Added to Cart' : 'Add Outfit to Cart'}
                  </button>
                  <button
                    type="button"
                    onClick={handleTryOutfit}
                    className="flex items-center justify-center gap-2 border border-primary/40 text-primary rounded-full py-2.5 text-sm font-semibold hover:bg-primary/5 transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    Try This Outfit
                  </button>
                </div>
                <p className="text-[11px] text-on-surface-variant text-center mt-3">
                  Virtual try-on currently previews one item at a time — we'll open it with this outfit's top.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {tryOnProduct && (
        <GarmentTryOn product={tryOnProduct} onClose={() => setTryOnProduct(null)} />
      )}
    </div>
  );
}
