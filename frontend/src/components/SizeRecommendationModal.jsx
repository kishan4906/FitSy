import { useState } from 'react';
import { Ruler, Check, AlertCircle, Loader2 } from 'lucide-react';
import * as api from '../services/api';
import { useAuth } from '../context/AuthContext';

const FIT_PREFERENCES = [
  { value: 'slim', label: 'Slim' },
  { value: 'regular', label: 'Regular' },
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'oversized', label: 'Oversized' },
];

const MEASUREMENT_FIELDS = [
  { key: 'height', label: 'Height', unit: 'cm' },
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'chest', label: 'Chest', unit: 'cm' },
  { key: 'waist', label: 'Waist', unit: 'cm' },
  { key: 'hip', label: 'Hip', unit: 'cm' },
];

export default function SizeRecommendationModal({ product, onClose, onSelectSize }) {
  const { isAuthenticated, user, updateFitProfile } = useAuth();

  const [measurements, setMeasurements] = useState({
    height: user?.fitProfile?.height || '',
    weight: user?.fitProfile?.weight || '',
    chest: user?.fitProfile?.chest || '',
    waist: user?.fitProfile?.waist || '',
    hip: user?.fitProfile?.hip || '',
  });
  const [fitPreference, setFitPreference] = useState(user?.fitProfile?.fitPreference || 'regular');
  const [saveProfile, setSaveProfile] = useState(false);

  // idle | loading | success | error
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState(null);

  const hasSavedProfile = isAuthenticated && user?.fitProfile && (user.fitProfile.chest || user.fitProfile.waist);

  function applySavedProfile() {
    setMeasurements({
      height: user.fitProfile.height || '',
      weight: user.fitProfile.weight || '',
      chest: user.fitProfile.chest || '',
      waist: user.fitProfile.waist || '',
      hip: user.fitProfile.hip || '',
    });
    if (user.fitProfile.fitPreference) setFitPreference(user.fitProfile.fitPreference);
  }

  function handleChange(key, value) {
    setMeasurements((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setStatus('loading');
    setErrorMessage('');
    setResult(null);

    const numericMeasurements = Object.fromEntries(
      Object.entries(measurements)
        .filter(([, v]) => v !== '' && v !== null && v !== undefined)
        .map(([k, v]) => [k, Number(v)])
    );

    const { data, error } = await api.sizeRecommendation.recommend({
      productId: product.id || product._id,
      measurements: numericMeasurements,
      fitPreference,
    });

    if (error || !data?.success) {
      setStatus('error');
      setErrorMessage(error || data?.message || 'Something went wrong. Please try again.');
      return;
    }

    setResult(data.data);
    setStatus('success');

    if (saveProfile && isAuthenticated) {
      await updateFitProfile({ ...numericMeasurements, fitPreference });
    }
  }

  function handleSelectSize(size) {
    onSelectSize(size);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-outline-variant p-6 rounded-3xl max-w-lg w-full shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold text-on-surface flex items-center gap-2">
            <Ruler className="w-5 h-5 text-primary" /> Find Your Size
          </h3>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface font-bold text-xl">
            &times;
          </button>
        </div>

        {status !== 'success' && (
          <>
            {hasSavedProfile && (
              <button
                type="button"
                onClick={applySavedProfile}
                className="w-full mb-4 text-xs font-semibold text-primary border border-primary/30 rounded-lg py-2 hover:bg-primary/5 transition-colors"
              >
                Use My Saved Measurements
              </button>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {MEASUREMENT_FIELDS.map(({ key, label, unit }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-on-surface-variant mb-1 block">
                      {label} ({unit})
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={measurements[key]}
                      onChange={(e) => handleChange(key, e.target.value)}
                      placeholder={key === 'chest' || key === 'waist' ? 'Recommended' : 'Optional'}
                      className="w-full rounded-lg border border-outline-variant/50 bg-surface px-3 py-2 text-sm text-on-surface"
                    />
                  </div>
                ))}
              </div>

              <div>
                <label className="text-xs font-semibold text-on-surface-variant mb-1 block">Preferred Fit</label>
                <div className="grid grid-cols-4 gap-2">
                  {FIT_PREFERENCES.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFitPreference(value)}
                      className={`py-2 rounded-lg text-xs font-bold border transition-all ${
                        fitPreference === value
                          ? 'bg-primary text-white border-primary'
                          : 'bg-surface border-outline-variant/60 text-on-surface hover:border-primary'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {isAuthenticated && (
                <label className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                  <input
                    type="checkbox"
                    checked={saveProfile}
                    onChange={(e) => setSaveProfile(e.target.checked)}
                    className="rounded border-outline-variant"
                  />
                  Save these measurements to my profile for next time
                </label>
              )}

              {status === 'error' && (
                <div className="flex items-start gap-2 bg-error-container/20 border border-error/30 text-on-surface rounded-xl p-3 text-xs">
                  <AlertCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'loading' || !(measurements.chest || measurements.waist || measurements.hip)}
                className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-white rounded-full font-bold text-xs disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Calculating…
                  </>
                ) : (
                  'Recommend My Size'
                )}
              </button>
              <p className="text-[11px] text-on-surface-variant text-center">
                Enter at least chest, waist, or hip. Recommendations are a likely fit based on your measurements, not a guarantee.
              </p>
            </form>
          </>
        )}

        {status === 'success' && result && (
          <div className="space-y-4">
            {result.status === 'ok' && (
              <>
                <div className="text-center py-2">
                  <p className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider mb-1">
                    Your Recommended Size
                  </p>
                  <p className="text-4xl font-bold text-primary mb-2">{result.recommendedSize}</p>
                  <span
                    className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                      result.confidence === 'high'
                        ? 'bg-emerald-500/10 text-emerald-600'
                        : result.confidence === 'medium'
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-outline-variant/30 text-on-surface-variant'
                    }`}
                  >
                    Confidence: {result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1)}
                  </span>
                  {result.reason && (
                    <p className="text-sm text-on-surface-variant italic mt-3">"{result.reason}"</p>
                  )}
                </div>

                <div className="space-y-2">
                  {Object.entries(result.measurementBreakdown || {}).map(([dim, d]) => (
                    <div
                      key={dim}
                      className="flex items-center justify-between text-xs bg-surface-container-low rounded-lg px-3 py-2"
                    >
                      <span className="font-semibold capitalize text-on-surface">{dim}</span>
                      <span className="text-on-surface-variant">
                        You: {d.user}cm · Range: {d.min}–{d.max}cm
                      </span>
                      {d.match ? (
                        <Check className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                      )}
                    </div>
                  ))}
                </div>

                {result.alternative && (
                  <p className="text-xs text-on-surface-variant text-center">
                    Alternative: <span className="font-bold text-on-surface">{result.alternative}</span>
                  </p>
                )}

                <button
                  onClick={() => handleSelectSize(result.recommendedSize)}
                  className="w-full py-3 bg-primary text-white rounded-full font-bold text-sm"
                >
                  Select {result.recommendedSize}
                </button>
                {result.alternative && (
                  <button
                    onClick={() => handleSelectSize(result.alternative)}
                    className="w-full py-2.5 border border-outline-variant/60 text-on-surface rounded-full font-semibold text-xs"
                  >
                    Select {result.alternative} instead
                  </button>
                )}
              </>
            )}

            {result.status === 'no_chart' && (
              <div className="text-center py-6">
                <AlertCircle className="w-8 h-8 text-on-surface-variant mx-auto mb-3" />
                <p className="text-sm text-on-surface-variant">{result.message}</p>
              </div>
            )}

            {result.status === 'no_match' && (
              <div className="text-center py-6">
                <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
                <p className="text-sm text-on-surface-variant">{result.message}</p>
              </div>
            )}

            <button
              onClick={() => setStatus('idle')}
              className="w-full py-2.5 text-xs font-semibold text-primary hover:underline"
            >
              Try different measurements
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
