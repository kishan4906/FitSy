// ─── Size Recommendation Service ──────────────────────────────────────────────
// Pure, deterministic measurement matching. This is the ONLY thing that ever
// decides which size is recommended — no AI call sits anywhere in this file.
// aiStylistService-style AI is used elsewhere purely to phrase the "reason"
// text from the result this module already computed; it cannot change the
// recommended size.
// ─────────────────────────────────────────────────────────────────────────────

const REALISTIC_RANGES = {
  height: { min: 100, max: 230 }, // cm
  weight: { min: 25, max: 250 }, // kg
  chest: { min: 50, max: 180 }, // cm
  waist: { min: 40, max: 180 }, // cm
  hip: { min: 50, max: 180 }, // cm
  shoulder: { min: 25, max: 70 }, // cm
};

const CM_PER_INCH = 2.54;

/**
 * Validates raw measurement input. Returns { valid, errors, measurements }
 * where `measurements` only contains the fields that were both provided and
 * numeric/in-range — never trusts the caller's types.
 */
function validateMeasurements(rawMeasurements = {}) {
  const errors = [];
  const measurements = {};

  for (const key of Object.keys(REALISTIC_RANGES)) {
    const value = rawMeasurements[key];
    if (value === undefined || value === null || value === '') continue;

    const num = Number(value);
    if (Number.isNaN(num)) {
      errors.push(`${key} must be a number.`);
      continue;
    }
    const { min, max } = REALISTIC_RANGES[key];
    if (num <= 0) {
      errors.push(`${key} must be a positive value.`);
      continue;
    }
    if (num < min || num > max) {
      errors.push(`${key} of ${num} is outside a realistic range (${min}–${max}).`);
      continue;
    }
    measurements[key] = num;
  }

  return { valid: errors.length === 0, errors, measurements };
}

/**
 * Fit preference nudges which part of a range is treated as "ideal":
 * slim → prefers being near the lower bound; oversized → prefers the upper
 * bound / tolerates being slightly over. This only affects scoring/ranking
 * among sizes that are already valid candidates — it never manufactures a
 * size or range that doesn't exist in the chart.
 */
const FIT_PREFERENCE_BIAS = {
  slim: 0.25, // ideal point = min + 25% of range
  regular: 0.5, // ideal point = midpoint
  relaxed: 0.7,
  oversized: 0.85,
};

function scoreMeasurementAgainstRange(value, min, max, bias) {
  if (min === undefined || max === undefined || Number.isNaN(min) || Number.isNaN(max)) {
    return null; // this dimension isn't defined for this size — skip it, don't penalize
  }
  const range = max - min;
  const idealPoint = min + range * bias;

  if (value >= min && value <= max) {
    // Within range: score is how close to the "ideal point" for this
    // fit preference, normalized 0..1 (1 = exactly ideal).
    const distanceFromIdeal = Math.abs(value - idealPoint);
    const maxPossibleDistance = Math.max(idealPoint - min, max - idealPoint) || 1;
    return 1 - Math.min(distanceFromIdeal / maxPossibleDistance, 1) * 0.3; // stays in 0.7–1.0 band
  }

  // Outside range: penalize by how far outside, but don't zero it out
  // instantly — a measurement 1cm outside a boundary is still a near-miss.
  const distanceOutside = value < min ? min - value : value - max;
  const penalty = distanceOutside / (range || 10);
  return Math.max(0, 0.7 - penalty * 0.5);
}

/**
 * @param {{chest?, waist?, hip?}} measurements - already validated, cm
 * @param {Array<{size, chestMin, chestMax, waistMin, waistMax, hipMin, hipMax}>} sizeChart
 * @param {string} fitPreference - 'slim' | 'regular' | 'relaxed' | 'oversized'
 * @param {string[]} availableSizes - product.sizes, to filter the chart to what's actually purchasable
 */
function matchFromSizeChart(measurements, sizeChart, fitPreference, availableSizes) {
  const bias = FIT_PREFERENCE_BIAS[fitPreference] ?? FIT_PREFERENCE_BIAS.regular;
  const relevantDimensions = ['chest', 'waist', 'hip'].filter((dim) => measurements[dim] !== undefined);

  if (relevantDimensions.length === 0) {
    return { candidates: [], usedDimensions: [] };
  }

  const availableSet = new Set(availableSizes || []);
  const candidates = sizeChart
    .filter((entry) => availableSet.size === 0 || availableSet.has(entry.size))
    .map((entry) => {
      const dimensionResults = {};
      let totalScore = 0;
      let scoredDimensions = 0;

      for (const dim of relevantDimensions) {
        const min = entry[`${dim}Min`];
        const max = entry[`${dim}Max`];
        const score = scoreMeasurementAgainstRange(measurements[dim], min, max, bias);
        if (score === null) continue; // dimension not defined for this size
        dimensionResults[dim] = {
          user: measurements[dim],
          min,
          max,
          match: measurements[dim] >= min && measurements[dim] <= max,
        };
        totalScore += score;
        scoredDimensions += 1;
      }

      if (scoredDimensions === 0) return null;

      return {
        size: entry.size,
        score: totalScore / scoredDimensions,
        matchedDimensions: scoredDimensions,
        dimensionResults,
        allMatch: Object.values(dimensionResults).every((d) => d.match),
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return { candidates, usedDimensions: relevantDimensions };
}

/**
 * Numeric-waist categories (e.g. jeans sized "24"–"32") store the waist
 * measurement directly as the size label — no separate chart needed. We
 * match the user's waist (cm, converted to inches — these labels are
 * conventionally inches) to the closest available numeric size.
 */
function matchNumericWaistSize(measurements, availableSizes) {
  if (measurements.waist === undefined) return { candidates: [] };

  const numericSizes = availableSizes
    .map((s) => Number(s))
    .filter((n) => !Number.isNaN(n));

  if (numericSizes.length === 0) return { candidates: [] };

  const userWaistInches = measurements.waist / CM_PER_INCH;

  const candidates = numericSizes
    .map((sizeInches) => {
      const distance = Math.abs(sizeInches - userWaistInches);
      // Within ~1 inch: strong match. Beyond ~3 inches: weak.
      const score = Math.max(0, 1 - distance / 3);
      return {
        size: String(sizeInches),
        score,
        matchedDimensions: 1,
        dimensionResults: {
          waist: {
            user: measurements.waist,
            min: Math.round((sizeInches - 0.5) * CM_PER_INCH),
            max: Math.round((sizeInches + 0.5) * CM_PER_INCH),
            match: distance <= 0.75,
          },
        },
        allMatch: distance <= 0.75,
      };
    })
    .sort((a, b) => b.score - a.score);

  return { candidates, usedDimensions: ['waist'] };
}

function scoreToConfidence(topCandidate, secondCandidate) {
  if (!topCandidate) return 'low';
  const { score, allMatch, matchedDimensions } = topCandidate;

  if (allMatch && matchedDimensions >= 2 && score >= 0.85) {
    // Clearly best, and not a near-tie with the runner-up
    if (!secondCandidate || score - secondCandidate.score >= 0.1) return 'high';
    return 'medium';
  }
  if (allMatch || score >= 0.65) return 'medium';
  return 'low';
}

/**
 * Main entry point.
 * @param {object} product - full product document (needs sizes, sizeChart, category)
 * @param {object} rawMeasurements - user-submitted measurements
 * @param {string} fitPreference
 * @returns {{status:'ok'|'no_chart'|'invalid'|'no_match', ...}}
 */
function recommendSize({ product, rawMeasurements, fitPreference = 'regular' }) {
  const { valid, errors, measurements } = validateMeasurements(rawMeasurements);
  if (!valid) {
    return { status: 'invalid', errors };
  }
  if (Object.keys(measurements).length === 0) {
    return { status: 'invalid', errors: ['At least one measurement (chest, waist, or hip) is required.'] };
  }

  const hasChart = Array.isArray(product.sizeChart) && product.sizeChart.length > 0;
  const isNumericWaistProduct = (product.sizes || []).every((s) => !Number.isNaN(Number(s)));

  let matchResult;
  if (hasChart) {
    matchResult = matchFromSizeChart(measurements, product.sizeChart, fitPreference, product.sizes);
  } else if (isNumericWaistProduct) {
    matchResult = matchNumericWaistSize(measurements, product.sizes);
  } else {
    return {
      status: 'no_chart',
      message: 'No size chart is available for this product yet. Please refer to the general size guide.',
    };
  }

  const { candidates, usedDimensions } = matchResult;

  if (candidates.length === 0) {
    return {
      status: 'invalid',
      errors: [`Please provide ${isNumericWaistProduct ? 'a waist' : 'at least one of chest, waist, or hip'} measurement for this product.`],
    };
  }

  const [top, second] = candidates;

  if (top.score < 0.25) {
    return {
      status: 'no_match',
      message: "Your measurements fall outside the available size ranges. Please check the product's sizing information or consider a different product.",
      closestSize: top.size,
    };
  }

  const confidence = scoreToConfidence(top, second);
  const alternative =
    second && Math.abs(second.score - top.score) < 0.12 && second.size !== top.size ? second.size : null;

  return {
    status: 'ok',
    recommendedSize: top.size,
    confidence,
    alternative,
    usedDimensions,
    measurementBreakdown: top.dimensionResults,
    alternativeReason: alternative
      ? `${top.size} is the closest measurement match. ${alternative} may provide a looser fit.`
      : null,
  };
}

function buildDeterministicReason({ recommendedSize, measurementBreakdown, alternative, alternativeReason }) {
  const matchedDims = Object.entries(measurementBreakdown || {})
    .filter(([, d]) => d.match)
    .map(([dim]) => dim);

  if (matchedDims.length === 0) {
    return `${recommendedSize} is the closest available match based on your measurements.`;
  }
  const dimList = matchedDims.length === 1 ? matchedDims[0] : `${matchedDims.slice(0, -1).join(', ')} and ${matchedDims[matchedDims.length - 1]}`;
  const base = `Your ${dimList} measurement${matchedDims.length > 1 ? 's' : ''} fall within the ${recommendedSize} size range for this product.`;
  return alternative ? `${base} ${alternativeReason}` : base;
}

module.exports = {
  validateMeasurements,
  recommendSize,
  buildDeterministicReason,
  REALISTIC_RANGES,
};
