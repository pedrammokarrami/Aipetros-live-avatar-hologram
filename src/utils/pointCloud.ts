export interface PointCloudData {
  positions: Float32Array;
  seeds: Float32Array;
  scales: Float32Array;
  mouthWeights: Float32Array;
  jawWeights: Float32Array;
  fades: Float32Array;
  count: number;
  isFullBody: boolean;
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    minZ: number;
    maxZ: number;
    width: number;
    height: number;
    depth: number;
  };
}

export interface NormalizedAvatarResult {
  positions: Float32Array;
  isFullBody: boolean;
  bounds: PointCloudData['bounds'];
}

const TARGET_FULL_BODY_HEIGHT = 2.16;
const TARGET_BUST_HEIGHT = 2.02;
const FULL_BODY_Y_OFFSET = 0.04;
const BUST_Y_OFFSET = 0.08;

/** Deterministic fast PRNG (Mulberry32) so point clouds are reproducible and testable. */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeBounds(positions: Float32Array): PointCloudData['bounds'] {
  if (positions.length < 3) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      width: 0,
      height: 0,
      depth: 0,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX)) {
    return {
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      minZ: 0,
      maxZ: 0,
      width: 0,
      height: 0,
      depth: 0,
    };
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
    minZ,
    maxZ,
    width: Math.max(1e-5, maxX - minX),
    height: Math.max(1e-5, maxY - minY),
    depth: Math.max(1e-5, maxZ - minZ),
  };
}

/**
 * Normalizes any avatar point set (full-body human OR upper-body bust) without cropping:
 * - Detects whether the geometry is a full-body figure (height / width > 1.72) or a bust.
 * - Centers X/Z to 0 and scales cleanly so the full avatar fits comfortably in the viewport.
 */
export function normalizeAvatarPointCloud(rawPositions: Float32Array): NormalizedAvatarResult {
  const valid: number[] = [];
  for (let i = 0; i < rawPositions.length; i += 3) {
    const x = rawPositions[i];
    const y = rawPositions[i + 1];
    const z = rawPositions[i + 2];
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      valid.push(x, y, z);
    }
  }

  const clean = new Float32Array(valid);
  const initialBounds = computeBounds(clean);
  const aspectRatio = initialBounds.height / Math.max(initialBounds.width, 1e-4);
  const isFullBody = aspectRatio > 1.72;

  const centerX = (initialBounds.minX + initialBounds.maxX) * 0.5;
  const centerY = (initialBounds.minY + initialBounds.maxY) * 0.5;
  const centerZ = (initialBounds.minZ + initialBounds.maxZ) * 0.5;

  const targetHeight = isFullBody ? TARGET_FULL_BODY_HEIGHT : TARGET_BUST_HEIGHT;
  const yOffset = isFullBody ? FULL_BODY_Y_OFFSET : BUST_Y_OFFSET;

  const scaleByHeight = targetHeight / Math.max(initialBounds.height, 1e-4);
  const maxAllowedWidth = isFullBody ? 1.45 : 1.88;
  const scaleByWidth = maxAllowedWidth / Math.max(initialBounds.width, 1e-4);
  const scale = Math.min(scaleByHeight, scaleByWidth * 1.15);

  const normalized = new Float32Array(clean.length);
  for (let i = 0; i < clean.length; i += 3) {
    normalized[i] = (clean[i] - centerX) * scale;
    normalized[i + 1] = (clean[i + 1] - centerY) * scale + yOffset;
    normalized[i + 2] = (clean[i + 2] - centerZ) * scale;
  }

  return {
    positions: normalized,
    isFullBody,
    bounds: computeBounds(normalized),
  };
}

/**
 * Computes anatomical lip-sync weights (mouth parting + lower-jaw drop) and depth/edge fades
 * for both full-body standing humans and upper-body busts.
 */
export function computeAnatomicalWeights(
  x: number,
  y: number,
  z: number,
  bounds: PointCloudData['bounds'],
  isFullBody = true,
): { mouthWeight: number; jawWeight: number; fade: number; scaleBias: number } {
  const ny = (y - bounds.minY) / Math.max(bounds.height, 1e-4); // 0 = feet/bottom, 1 = crown
  const nx = x / Math.max(bounds.width * 0.5, 1e-4); // -1..1
  const nz = (z - bounds.minZ) / Math.max(bounds.depth, 1e-4); // 0 = back, 1 = front

  // In a standing full-body figure (~7.5 heads tall), the head spans ny 0.87..1.00:
  // mouth is around ny = 0.903 and jaw/chin around ny = 0.886.
  // In an upper-body bust, mouth is around ny = 0.735 and jaw/chin around ny = 0.685.
  const mouthCenterY = isFullBody ? 0.903 : 0.735;
  const mouthRadiusY = isFullBody ? 0.017 : 0.048;
  const mouthRadiusX = isFullBody ? 0.22 : 0.24;

  const dyMouth = (ny - mouthCenterY) / mouthRadiusY;
  const dxMouth = nx / mouthRadiusX;
  const frontMask = Math.max(0, Math.min(1, (nz - 0.52) / 0.2));
  const mouthRadial = Math.exp(-0.5 * (dxMouth * dxMouth + dyMouth * dyMouth));
  const mouthWeight = Math.max(0, Math.min(1, mouthRadial * frontMask));

  const jawCenterY = isFullBody ? 0.886 : 0.685;
  const jawRadiusY = isFullBody ? 0.028 : 0.085;
  const jawRadiusX = isFullBody ? 0.30 : 0.34;

  const dyJaw = (ny - jawCenterY) / jawRadiusY;
  const dxJaw = nx / jawRadiusX;
  const jawFrontMask = Math.max(0, Math.min(1, (nz - 0.44) / 0.22));
  const jawRadial = Math.exp(-0.5 * (dxJaw * dxJaw + dyJaw * dyJaw));
  const jawWeight = Math.max(0, Math.min(1, jawRadial * jawFrontMask));

  // Full-body figures stay crisp all the way down to the feet; busts fade softly at chest cutoff
  const bottomFade = isFullBody
    ? 0.88 + 0.12 * Math.min(1, ny / 0.08)
    : Math.max(0.06, Math.min(1, Math.pow(ny / 0.19, 1.15)));

  // Front-to-back depth contrast keeps front facial & body contours crisp
  const frontDepth = Math.max(0, Math.min(1, nz));
  const depthFade = 0.38 + 0.62 * Math.pow(frontDepth, 1.18);

  const isFaceBand = isFullBody
    ? ny > 0.87 && ny < 0.985 && Math.abs(nx) < 0.42 && nz > 0.52
    : ny > 0.64 && ny < 0.92 && Math.abs(nx) < 0.42 && nz > 0.56;
  const featureLift = isFaceBand ? 1.18 : 1.0;
  const fade = Math.min(1.18, bottomFade * depthFade * featureLift);

  const scaleBias = isFaceBand ? 0.88 : 1.02;

  return { mouthWeight, jawWeight, fade, scaleBias };
}

/**
 * Spatial voxel-grid thinning so individual glowing cyan cells remain crisp, spaced out,
 * and free of overlapping whiteout clusters regardless of input mesh density.
 */
export function buildCellularPointCloud(
  normalizedPositions: Float32Array,
  options: {
    minSpacing?: number;
    maxPoints?: number;
    seed?: number;
    isFullBody?: boolean;
  } = {},
): PointCloudData {
  const maxPoints = options.maxPoints ?? 15500;
  let spacing = options.minSpacing ?? 0.015;
  const rand = createSeededRandom(options.seed ?? 1337);
  const isFullBody = options.isFullBody ?? true;

  const totalInput = Math.floor(normalizedPositions.length / 3);
  if (totalInput === 0) {
    return {
      positions: new Float32Array(0),
      seeds: new Float32Array(0),
      scales: new Float32Array(0),
      mouthWeights: new Float32Array(0),
      jawWeights: new Float32Array(0),
      fades: new Float32Array(0),
      count: 0,
      isFullBody,
      bounds: computeBounds(normalizedPositions),
    };
  }

  const indices = new Uint32Array(totalInput);
  for (let i = 0; i < totalInput; i++) indices[i] = i;
  for (let i = totalInput - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }

  let selectedIndices: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const occupied = new Set<string>();
    const chosen: number[] = [];
    const invSpacing = 1 / spacing;

    for (let k = 0; k < totalInput; k++) {
      const idx = indices[k];
      const base = idx * 3;
      const x = normalizedPositions[base];
      const y = normalizedPositions[base + 1];
      const z = normalizedPositions[base + 2];

      const gx = Math.floor(x * invSpacing);
      const gy = Math.floor(y * invSpacing);
      const gz = Math.floor(z * invSpacing);
      const key = `${gx},${gy},${gz}`;

      if (!occupied.has(key)) {
        occupied.add(key);
        chosen.push(idx);
      }
    }

    selectedIndices = chosen;
    if (chosen.length <= maxPoints) break;
    const ratio = Math.cbrt(chosen.length / maxPoints);
    spacing *= Math.max(1.12, ratio * 1.04);
  }

  if (selectedIndices.length > maxPoints) {
    selectedIndices = selectedIndices.slice(0, maxPoints);
  }

  const count = selectedIndices.length;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const mouthWeights = new Float32Array(count);
  const jawWeights = new Float32Array(count);
  const fades = new Float32Array(count);

  const bounds = computeBounds(normalizedPositions);

  for (let i = 0; i < count; i++) {
    const src = selectedIndices[i] * 3;
    const x = normalizedPositions[src];
    const y = normalizedPositions[src + 1];
    const z = normalizedPositions[src + 2];

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    seeds[i * 3] = rand() * Math.PI * 2;
    seeds[i * 3 + 1] = 0.55 + rand() * 0.9;
    seeds[i * 3 + 2] = 0.65 + rand() * 0.7;

    const weights = computeAnatomicalWeights(x, y, z, bounds, isFullBody);
    mouthWeights[i] = weights.mouthWeight;
    jawWeights[i] = weights.jawWeight;
    fades[i] = weights.fade;
    scales[i] = (0.68 + rand() * 0.36) * weights.scaleBias;
  }

  return {
    positions,
    seeds,
    scales,
    mouthWeights,
    jawWeights,
    fades,
    count,
    isFullBody,
    bounds: computeBounds(positions),
  };
}

/**
 * Generates a complete, anatomically proportioned standing full-body female human
 * holographic point cloud (head with sculpted facial contours & flowing hair, slender neck,
 * rounded shoulders, arms, forearms, hands, sculpted torso, waist, hips, thighs, knees,
 * calves, ankles, and feet).
 */
export function generateProceduralFullBodyHuman(
  options: { maxPoints?: number; minSpacing?: number; seed?: number } = {},
): PointCloudData {
  const rand = createSeededRandom(options.seed ?? 2026);
  const raw: number[] = [];

  const pushPt = (x: number, y: number, z: number, jitter = 0.0018) => {
    raw.push(
      x + (rand() - 0.5) * jitter,
      y + (rand() - 0.5) * jitter,
      z + (rand() - 0.5) * jitter,
    );
  };

  // Helper: sample a smooth tubular limb segment along a 3D centerline curve
  const sampleLimb = (
    rings: number,
    segs: number,
    evalCrossSection: (t: number) => {
      cx: number;
      cy: number;
      cz: number;
      rx: number;
      rz: number;
    },
  ) => {
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const { cx, cy, cz, rx, rz } = evalCrossSection(t);
      for (let s = 0; s < segs; s++) {
        const a = ((s + (r % 2) * 0.5) / segs) * Math.PI * 2;
        pushPt(cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz, 0.0016);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 1. SCULPTED HEAD & FACE (crown ~ +1.055, chin ~ +0.785, center ~ +0.92)
  // ---------------------------------------------------------------------------
  const headCenterY = 0.92;
  const headLatSteps = 56;
  const headLonSteps = 76;

  for (let i = 1; i < headLatSteps; i++) {
    const v = i / headLatSteps;
    const phi = v * Math.PI;
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    const lonCount = Math.max(12, Math.round(headLonSteps * sinPhi));

    for (let j = 0; j < lonCount; j++) {
      const u = (j + (i % 2) * 0.5) / lonCount;
      const theta = u * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      let rx = 0.098;
      let ry = 0.135;
      let rz = 0.112;

      if (cosPhi < 0) {
        const lowerT = -cosPhi;
        rx *= 1.0 - 0.36 * Math.pow(lowerT, 1.35);
        rz *= 1.0 - 0.22 * Math.pow(lowerT, 1.5);
      }

      let x = rx * sinPhi * sinT;
      let y = headCenterY + ry * cosPhi;
      let z = rz * sinPhi * cosT + 0.008;

      if (cosT > 0.15) {
        const frontAngle = Math.atan2(sinT, cosT);
        const absAngle = Math.abs(frontAngle);

        const cheek =
          Math.exp(-Math.pow((absAngle - 0.58) / 0.24, 2)) *
          Math.exp(-Math.pow((cosPhi + 0.08) / 0.18, 2));
        z += 0.009 * cheek;
        x += Math.sign(sinT) * 0.005 * cheek;

        const brow =
          Math.exp(-Math.pow((cosPhi - 0.24) / 0.075, 2)) *
          Math.exp(-Math.pow(absAngle / 0.72, 2));
        z += 0.007 * brow;

        const eyeSocket =
          Math.exp(-Math.pow((absAngle - 0.36) / 0.15, 2)) *
          Math.exp(-Math.pow((cosPhi - 0.08) / 0.095, 2));
        z -= 0.011 * eyeSocket;

        const noseBridge =
          Math.exp(-Math.pow(absAngle / 0.11, 2)) *
          Math.exp(-Math.pow((cosPhi + 0.06) / 0.16, 2));
        const noseTip =
          Math.exp(-Math.pow(absAngle / 0.095, 2)) *
          Math.exp(-Math.pow((cosPhi + 0.2) / 0.065, 2));
        z += 0.015 * noseBridge + 0.018 * noseTip;

        const lipWidth = Math.exp(-Math.pow(absAngle / 0.24, 2));
        const upperLip = Math.exp(-Math.pow((cosPhi + 0.4) / 0.036, 2)) * lipWidth;
        const lipPart = Math.exp(-Math.pow((cosPhi + 0.45) / 0.016, 2)) * lipWidth;
        const lowerLip = Math.exp(-Math.pow((cosPhi + 0.5) / 0.04, 2)) * lipWidth;
        z += 0.009 * upperLip - 0.004 * lipPart + 0.009 * lowerLip;

        const chin =
          Math.exp(-Math.pow(absAngle / 0.24, 2)) *
          Math.exp(-Math.pow((cosPhi + 0.76) / 0.12, 2));
        z += 0.009 * chin;
        y -= 0.004 * chin;
      }

      if (cosPhi < -0.78 && cosT < 0.25) continue;
      pushPt(x, y, z, 0.0012);
    }
  }

  // Facial Feature Accents (eyelids, brows, nasal ridge, lips)
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 20; k++) {
      const t = (k / 19) * Math.PI * 2;
      pushPt(
        side * 0.035 + Math.cos(t) * 0.014,
        headCenterY + 0.012 + Math.sin(t) * 0.006,
        0.106 - Math.abs(Math.cos(t)) * 0.007,
        0.0006,
      );
    }
    for (let k = 0; k < 14; k++) {
      const u = k / 13;
      pushPt(
        side * (0.016 + u * 0.036),
        headCenterY + 0.031 + Math.sin(u * Math.PI) * 0.007 - u * 0.003,
        0.111 - u * 0.013,
        0.0006,
      );
    }
  }
  for (let k = 0; k < 14; k++) {
    const u = k / 13;
    const nyPos = headCenterY + 0.022 - u * 0.052;
    const nzPos = 0.115 + Math.sin(u * Math.PI * 0.85) * 0.015;
    pushPt(0, nyPos, nzPos, 0.0006);
  }
  for (let k = 0; k < 22; k++) {
    const u = (k / 21) * 2 - 1;
    const lx = u * 0.027;
    const arch = Math.cos(u * Math.PI * 0.5);
    const upperY = headCenterY - 0.053 + 0.0045 * arch;
    const lowerY = headCenterY - 0.062 - 0.0045 * arch;
    const lz = 0.108 + 0.008 * arch - u * u * 0.009;
    pushPt(lx, upperY, lz, 0.0006);
    pushPt(lx, lowerY, lz - 0.001, 0.0006);
  }

  // Flowing Shoulder-Length Hair Framing Head & Nape
  const hairStrands = 72;
  const hairSteps = 26;
  for (let s = 0; s < hairStrands; s++) {
    const angle = (s / hairStrands) * Math.PI * 2;
    if (Math.cos(angle) > 0.64) continue;
    const sideFactor = Math.abs(Math.sin(angle));
    const backFactor = Math.max(0, -Math.cos(angle));
    const strandPhase = rand() * Math.PI * 2;
    const layerOffset = 0.007 + rand() * 0.013;

    for (let k = 0; k < hairSteps; k++) {
      const t = k / (hairSteps - 1);
      const maxLen = 0.32 + 0.12 * backFactor + 0.05 * sideFactor;
      const y = headCenterY + 0.138 - t * maxLen;
      const crownCurve = Math.sin(Math.min(1, t * 1.45) * Math.PI * 0.55);
      const flare = t > 0.58 ? Math.pow((t - 0.58) / 0.42, 1.4) * (0.025 + 0.036 * sideFactor) : 0;
      const baseR = 0.108 * crownCurve + layerOffset + flare;
      const wave = Math.sin(t * 7.0 + strandPhase) * 0.006 * t;
      const x = Math.sin(angle) * (baseR + wave) * 1.03;
      const z = Math.cos(angle) * (baseR * 1.06 + wave) - 0.008 * t;
      if (z > 0.05 && y > headCenterY - 0.11) continue;
      pushPt(x, y, z, 0.0018);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. SLENDER NECK (y = 0.675 to 0.795)
  // ---------------------------------------------------------------------------
  sampleLimb(16, 28, (t) => {
    const y = 0.675 + t * 0.12;
    const flare = Math.pow(1 - t, 2.0) * 0.018;
    return {
      cx: 0,
      cy: y,
      cz: -0.01 + t * 0.014,
      rx: 0.048 + flare,
      rz: 0.050 + flare * 0.75,
    };
  });

  // ---------------------------------------------------------------------------
  // 3. TORSO: SHOULDERS, CHEST/BUST, TAPERED WAIST & HIPS/PELVIS (y = -0.02 to 0.68)
  // ---------------------------------------------------------------------------
  const torsoRings = 62;
  const torsoSegs = 68;
  for (let r = 0; r <= torsoRings; r++) {
    const t = r / torsoRings; // 0 = lower pelvis (-0.02), 1 = neck base (0.68)
    const y = -0.02 + t * 0.7;

    // Anatomical feminine X width profile from pelvis -> hips -> narrow waist -> ribcage -> shoulders -> neck
    let rx: number;
    if (t > 0.84) {
      // Smooth trapezius transition from shoulder crest (0.232) to neck base (0.066)
      const u = (t - 0.84) / 0.16;
      const s = 0.5 * (1 + Math.cos(u * Math.PI));
      rx = 0.066 + 0.166 * Math.pow(s, 0.82);
    } else if (t > 0.44) {
      // Waist (0.142 at t=0.44) broadening gracefully up to shoulders (0.232 at t=0.84)
      const u = (t - 0.44) / 0.4;
      const s = 0.5 - 0.5 * Math.cos(u * Math.PI);
      rx = 0.142 + 0.09 * s;
    } else if (t > 0.12) {
      // Hips (0.214 at t=0.14) tapering smoothly inward to waist (0.142 at t=0.44)
      const u = (t - 0.12) / 0.32;
      const s = 0.5 - 0.5 * Math.cos(u * Math.PI);
      rx = 0.214 - 0.072 * s;
    } else {
      // Lower hip curve rounding into upper thighs
      const u = t / 0.12;
      rx = 0.188 + 0.026 * Math.sin(u * Math.PI * 0.5);
    }

    // Anatomical Z depth profile (subtle lordosis lumbar curve + bust + pelvis)
    let rz = 0.105 + 0.022 * Math.sin(t * Math.PI);
    if (t > 0.88) {
      const u = (t - 0.88) / 0.12;
      rz = rz * (1 - u) + 0.064 * u;
    } else if (t < 0.28) {
      // Pelvis / glute fullness
      const hipDepth = Math.sin((t / 0.28) * Math.PI);
      rz += 0.02 * hipDepth;
    } else if (t > 0.35 && t < 0.55) {
      // Slim waist depth
      const waistDip = Math.sin(((t - 0.35) / 0.2) * Math.PI);
      rz -= 0.015 * waistDip;
    }

    // Natural S-curve spine offset along Z
    const spineZ =
      -0.012 +
      0.016 * Math.sin((t - 0.35) * Math.PI * 1.35) -
      0.014 * Math.exp(-Math.pow((t - 0.14) / 0.14, 2));

    for (let s = 0; s < torsoSegs; s++) {
      const a = ((s + (r % 2) * 0.5) / torsoSegs) * Math.PI * 2;
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);

      let x = sinA * rx;
      let z = cosA * rz + spineZ;
      let py = y;

      // Gentle anatomical shoulder slope blending smoothly into deltoid caps
      if (t > 0.72) {
        const slopeU = (t - 0.72) / 0.28;
        py -= 0.024 * Math.pow(Math.abs(sinA), 1.8) * Math.sin(slopeU * Math.PI * 0.65);
      }

      // Clavicle ridge across upper chest
      if (cosA > 0.25 && t > 0.78 && t < 0.9) {
        const clav =
          Math.exp(-Math.pow((t - 0.84) / 0.026, 2)) *
          Math.sin(Math.min(Math.PI, Math.abs(sinA) * Math.PI * 1.1));
        z += 0.009 * clav;
      }

      // Sculpted feminine bust contour
      if (cosA > 0.18 && t > 0.52 && t < 0.78) {
        const bustY = Math.exp(-Math.pow((t - 0.65) / 0.075, 2));
        const bustX =
          Math.exp(-Math.pow((Math.abs(sinA) - 0.38) / 0.26, 2)) +
          0.25 * Math.exp(-Math.pow(sinA / 0.22, 2));
        z += 0.046 * bustY * bustX * cosA;
      }

      // Subtle gluteal contour on lower back
      if (cosA < -0.15 && t > 0.02 && t < 0.26) {
        const gluteY = Math.exp(-Math.pow((t - 0.13) / 0.075, 2));
        const gluteX = Math.exp(-Math.pow((Math.abs(sinA) - 0.36) / 0.34, 2));
        z -= 0.038 * gluteY * gluteX * Math.abs(cosA);
      }

      // Subtle lumbar spine hollow
      if (cosA < -0.55 && t > 0.25 && t < 0.75) {
        z += 0.01 * Math.exp(-Math.pow(sinA / 0.16, 2));
      }

      pushPt(x, py, z, 0.0018);
    }
  }

  // ---------------------------------------------------------------------------
  // 4. LEFT & RIGHT ARMS, FOREARMS & GRACEFUL HANDS (y = -0.11 to +0.60)
  // ---------------------------------------------------------------------------
  for (let side = -1; side <= 1; side += 2) {
    // Rounded deltoid shoulder cap blending smoothly from torso collarbone into upper arm
    for (let r = 0; r <= 14; r++) {
      const u = r / 14;
      const phi = u * Math.PI * 0.68;
      const segs = 24;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const dx = side * (0.192 + Math.sin(phi) * 0.056 * (0.55 + 0.45 * Math.cos(a) * side));
        const dy = 0.532 + Math.cos(phi) * 0.048;
        const dz = -0.01 + Math.sin(phi) * Math.sin(a) * 0.052;
        pushPt(dx, dy, dz, 0.0016);
      }
    }

    // Upper arm + forearm (t=0 at shoulder y=0.54 -> t=1 at wrist y=-0.01)
    sampleLimb(42, 22, (t) => {
      const y = 0.54 - t * 0.55;
      // Natural relaxed poise: elbows slightly out past waist, wrists gently curving forward
      const elbowArch = Math.sin(t * Math.PI) * 0.032;
      const cx = side * (0.228 + t * 0.062 + elbowArch);
      const cz = -0.014 - Math.sin(t * Math.PI) * 0.016 + Math.pow(t, 1.8) * 0.046;

      // Taper from upper arm (0.052) -> elbow (0.042) -> forearm bulge (0.043) -> slender wrist (0.026)
      const forearmCurve = Math.exp(-Math.pow((t - 0.64) / 0.16, 2)) * 0.006;
      const radius = 0.052 * (1 - t * 0.5) + forearmCurve;
      return { cx, cy: y, cz, rx: radius * 0.94, rz: radius * 1.02 };
    });

    // Palm & delicate fingers (y = -0.01 down to -0.135)
    sampleLimb(12, 16, (t) => {
      const y = -0.01 - t * 0.12;
      const cx = side * (0.296 + t * 0.006 - t * t * 0.014);
      const cz = 0.034 + t * 0.022;
      const rx = 0.018 * (1 - t * 0.45);
      const rz = (0.036 - t * 0.014) * (1 - Math.pow(t, 2.2) * 0.45);
      return { cx, cy: y, cz, rx, rz };
    });
  }

  // ---------------------------------------------------------------------------
  // 5. LEFT & RIGHT LEGS: THIGHS, KNEES, CALVES, ANKLES & FEET (y = -1.07 to +0.04)
  // ---------------------------------------------------------------------------
  for (let side = -1; side <= 1; side += 2) {
    // Full leg loft (t=0 at hip/upper thigh y=0.02 -> t=1 at ankle y=-1.01)
    sampleLimb(68, 28, (t) => {
      const y = 0.02 - t * 1.03;

      // Natural poised stance: legs separate cleanly from hips down to slightly apart ankles
      const cx = side * (0.106 - t * 0.012 + Math.sin(t * Math.PI) * 0.008);

      // Subtle anatomical S-line of thigh -> knee -> calf -> ankle
      const calfBack = Math.exp(-Math.pow((t - 0.66) / 0.15, 2)) * -0.024;
      const kneeFront = Math.exp(-Math.pow((t - 0.48) / 0.11, 2)) * 0.012;
      const cz = -0.008 + kneeFront + calfBack;

      // Anatomical leg radius profile: full thigh -> defined knee -> sculpted calf -> slender ankle
      let r: number;
      if (t < 0.48) {
        // Thigh (0.094) tapering smoothly to knee (0.058)
        const u = t / 0.48;
        r = 0.094 - 0.036 * Math.pow(u, 0.88);
      } else {
        // Knee (0.058) -> calf muscle contour (0.062 at t=0.66) -> ankle (0.035 at t=1.0)
        const u = (t - 0.48) / 0.52;
        const calfBulge = Math.sin(Math.min(1, u * 1.45) * Math.PI) * 0.015;
        r = 0.058 * (1 - u * 0.4) + calfBulge;
      }

      return { cx, cy: y, cz, rx: r * 0.96, rz: r * 1.05 };
    });

    // Foot (y = -1.01 down to -1.07, extending forward along +Z from heel to toes)
    const footSteps = 14;
    const footSegs = 18;
    for (let f = 0; f <= footSteps; f++) {
      const t = f / footSteps; // 0 = heel (-0.045), 1 = toes (+0.125)
      const z = -0.042 + t * 0.165;
      const archHeight = 0.048 * Math.pow(1 - t, 0.85) + 0.012;
      const footWidth = 0.034 + 0.014 * Math.sin(t * Math.PI * 0.82) * (1 - t * 0.25);
      const cx = side * (0.094 + t * 0.012);
      const baseY = -1.07;

      for (let s = 0; s < footSegs; s++) {
        const a = (s / footSegs) * Math.PI * 2;
        const fx = cx + Math.cos(a) * footWidth;
        const fy = baseY + (Math.sin(a) * 0.5 + 0.5) * archHeight;
        pushPt(fx, fy, z, 0.0012);
      }
    }
  }

  const normalized = normalizeAvatarPointCloud(new Float32Array(raw));
  return buildCellularPointCloud(normalized.positions, {
    minSpacing: options.minSpacing ?? 0.015,
    maxPoints: options.maxPoints ?? 15500,
    seed: options.seed ?? 2026,
    isFullBody: true,
  });
}

// Keep alias exported for backwards compatibility
export const generateProceduralFemaleBust = generateProceduralFullBodyHuman;

/**
 * Generates a dense, razor-fine 3D particle point-cloud silhouette of a tactical special-ops
 * soldier in poised combat-ready stance: ballistic FAST helmet with comms ear-pro & visor,
 * plate carrier vest with chest magazine pouches, armored shoulder pauldrons, muscular gloved
 * arms, utility belt with drop-leg holster, combat trousers with knee pads, and tactical boots.
 */
export function generateProceduralTacticalSoldier(
  options: { maxPoints?: number; minSpacing?: number; seed?: number } = {},
): PointCloudData {
  const rand = createSeededRandom(options.seed ?? 4207);
  const raw: number[] = [];

  const pushPt = (x: number, y: number, z: number, jitter = 0.0016) => {
    raw.push(
      x + (rand() - 0.5) * jitter,
      y + (rand() - 0.5) * jitter,
      z + (rand() - 0.5) * jitter,
    );
  };

  const sampleBoxSurface = (
    cx: number,
    cy: number,
    cz: number,
    hx: number,
    hy: number,
    hz: number,
    step = 0.012,
  ) => {
    const nx = Math.max(2, Math.round((hx * 2) / step));
    const ny = Math.max(2, Math.round((hy * 2) / step));
    const nz = Math.max(2, Math.round((hz * 2) / step));
    for (let ix = 0; ix <= nx; ix++) {
      const x = cx - hx + (ix / nx) * hx * 2;
      for (let iy = 0; iy <= ny; iy++) {
        const y = cy - hy + (iy / ny) * hy * 2;
        pushPt(x, y, cz + hz, 0.0014);
        pushPt(x, y, cz - hz, 0.0014);
      }
      for (let iz = 0; iz <= nz; iz++) {
        const z = cz - hz + (iz / nz) * hz * 2;
        pushPt(x, cy + hy, z, 0.0014);
        pushPt(x, cy - hy, z, 0.0014);
      }
    }
    for (let iy = 0; iy <= ny; iy++) {
      const y = cy - hy + (iy / ny) * hy * 2;
      for (let iz = 0; iz <= nz; iz++) {
        const z = cz - hz + (iz / nz) * hz * 2;
        pushPt(cx + hx, y, z, 0.0014);
        pushPt(cx - hx, y, z, 0.0014);
      }
    }
  };

  const sampleLimb = (
    rings: number,
    segs: number,
    evalCross: (t: number) => { cx: number; cy: number; cz: number; rx: number; rz: number },
  ) => {
    for (let r = 0; r <= rings; r++) {
      const t = r / rings;
      const { cx, cy, cz, rx, rz } = evalCross(t);
      for (let s = 0; s < segs; s++) {
        const a = ((s + (r % 2) * 0.5) / segs) * Math.PI * 2;
        pushPt(cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz, 0.0018);
      }
    }
  };

  // ---------------------------------------------------------------------------
  // 1. BALLISTIC HELMET, VISOR, COMMS HEADSET & LOWER FACE MASK (y = 0.77..1.07)
  // ---------------------------------------------------------------------------
  const headY = 0.91;
  for (let i = 1; i < 46; i++) {
    const phi = (i / 46) * Math.PI;
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    const lonSteps = Math.max(14, Math.round(64 * sinP));
    for (let j = 0; j < lonSteps; j++) {
      const theta = ((j + (i % 2) * 0.5) / lonSteps) * Math.PI * 2;
      const sinT = Math.sin(theta);
      const cosT = Math.cos(theta);

      // Upper helmet dome sits wider & slightly brow-rimmed; lower jaw tapers into tactical balaclava
      const isHelmet = cosP > 0.08 || (cosP > -0.22 && cosT < 0.28);
      let rx = isHelmet ? 0.126 : 0.094;
      let ry = isHelmet ? 0.145 : 0.132;
      let rz = isHelmet ? 0.138 : 0.114;

      if (cosP < 0) {
        const lt = -cosP;
        rx *= 1 - 0.25 * Math.pow(lt, 1.3);
        rz *= 1 - 0.16 * Math.pow(lt, 1.4);
      }

      let x = rx * sinP * sinT;
      let y = headY + ry * cosP;
      let z = rz * sinP * cosT + 0.006;

      // Helmet front brow ridge + tactical goggles contour
      if (cosT > 0.35 && cosP > 0.04 && cosP < 0.28) {
        z += 0.016 * Math.exp(-Math.pow((cosP - 0.15) / 0.07, 2));
      }
      // Subtle respirator / lower-face jaw relief for lip-sync animation
      if (cosT > 0.45 && cosP < -0.25 && cosP > -0.68) {
        z += 0.012 * Math.exp(-Math.pow((cosP + 0.45) / 0.14, 2));
      }

      pushPt(x, y, z, 0.0014);
    }
  }

  // Helmet NVG front shroud + side tactical headset cups
  sampleBoxSurface(0, headY + 0.082, 0.142, 0.026, 0.022, 0.015, 0.01);
  for (let side = -1; side <= 1; side += 2) {
    sampleBoxSurface(side * 0.126, headY - 0.002, 0.0, 0.020, 0.038, 0.032, 0.011);
  }

  // ---------------------------------------------------------------------------
  // 2. NECK & COLLAR (y = 0.68..0.79)
  // ---------------------------------------------------------------------------
  sampleLimb(14, 28, (t) => ({
    cx: 0,
    cy: 0.68 + t * 0.11,
    cz: -0.006,
    rx: 0.072 - t * 0.01,
    rz: 0.074 - t * 0.01,
  }));

  // ---------------------------------------------------------------------------
  // 3. ARMORED TORSO & PLATE CARRIER VEST (y = -0.03..0.69)
  // ---------------------------------------------------------------------------
  const torsoRings = 58;
  const torsoSegs = 68;
  for (let r = 0; r <= torsoRings; r++) {
    const t = r / torsoRings;
    const y = -0.03 + t * 0.72;

    // Broad V-tapered tactical silhouette: hips (0.215) -> waist (0.198) -> broad chest/shoulders (0.288)
    let rx: number;
    if (t > 0.85) {
      const u = (t - 0.85) / 0.15;
      const s = 0.5 * (1 + Math.cos(u * Math.PI));
      rx = 0.088 + 0.20 * Math.pow(s, 0.72);
    } else if (t > 0.35) {
      const u = (t - 0.35) / 0.50;
      rx = 0.198 + 0.090 * Math.pow(u, 0.85);
    } else {
      const u = t / 0.35;
      rx = 0.218 - 0.020 * u;
    }

    // Thickened mid-chest plate carrier depth
    let rz = 0.128 + 0.032 * Math.sin(t * Math.PI);
    if (t > 0.32 && t < 0.82) {
      rz += 0.022 * Math.sin(((t - 0.32) / 0.50) * Math.PI);
    }
    if (t > 0.88) {
      const u = (t - 0.88) / 0.12;
      rz = rz * (1 - u) + 0.082 * u;
    }

    for (let s = 0; s < torsoSegs; s++) {
      const a = ((s + (r % 2) * 0.5) / torsoSegs) * Math.PI * 2;
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);
      const x = sinA * rx;
      let z = cosA * rz;
      let py = y;

      if (t > 0.76) {
        const slope = (t - 0.76) / 0.24;
        py -= 0.026 * Math.pow(Math.abs(sinA), 1.6) * slope;
      }

      // Plate carrier front armor bevel
      if (cosA > 0.38 && t > 0.36 && t < 0.80 && Math.abs(sinA) < 0.68) {
        z += 0.018;
      }

      pushPt(x, py, z, 0.0018);
    }
  }

  // Front Tactical MOLLE Magazine Pouches (3 across lower plate carrier) + Admin Chest Rig + Back Pack
  for (const px of [-0.082, 0.0, 0.082]) {
    sampleBoxSurface(px, 0.27, 0.188, 0.034, 0.068, 0.026, 0.012);
  }
  sampleBoxSurface(0.0, 0.43, 0.182, 0.115, 0.052, 0.022, 0.013);
  sampleBoxSurface(-0.115, 0.54, 0.158, 0.026, 0.044, 0.020, 0.011); // Shoulder radio
  sampleBoxSurface(0.0, 0.38, -0.175, 0.138, 0.175, 0.048, 0.015); // Tactical back pack

  // Heavy Utility Belt (y = 0.04..0.11)
  sampleLimb(8, 56, (t) => ({
    cx: 0,
    cy: 0.035 + t * 0.072,
    cz: 0.004,
    rx: 0.228,
    rz: 0.156,
  }));

  // ---------------------------------------------------------------------------
  // 4. ARMORED SHOULDERS, ARMS & GLOVED HANDS (combat-ready wide stance)
  // ---------------------------------------------------------------------------
  for (let side = -1; side <= 1; side += 2) {
    // Rounded tactical shoulder pauldron
    for (let r = 0; r <= 14; r++) {
      const u = r / 14;
      const phi = u * Math.PI * 0.72;
      for (let s = 0; s < 26; s++) {
        const a = (s / 26) * Math.PI * 2;
        const dx = side * (0.242 + Math.sin(phi) * 0.072 * (0.55 + 0.45 * Math.cos(a) * side));
        const dy = 0.56 + Math.cos(phi) * 0.068;
        const dz = -0.005 + Math.sin(phi) * Math.sin(a) * 0.068;
        pushPt(dx, dy, dz, 0.0016);
      }
    }

    // Muscular armored upper arm -> elbow pad -> rugged forearm -> wrist
    sampleLimb(42, 24, (t) => {
      const y = 0.55 - t * 0.56;
      const outBow = Math.sin(t * Math.PI) * 0.048;
      const cx = side * (0.276 + t * 0.092 + outBow);
      const cz = -0.012 - Math.sin(t * Math.PI) * 0.024 + Math.pow(t, 1.5) * 0.056;
      const sleeveFold = Math.sin(t * 24) * 0.004;
      const rad = 0.074 * (1 - t * 0.36) + sleeveFold;
      return { cx, cy: y, cz, rx: rad, rz: rad * 1.04 };
    });

    // Tactical gloved hand & fingers poised slightly open
    sampleLimb(12, 18, (t) => {
      const y = -0.01 - t * 0.135;
      const cx = side * (0.372 + t * 0.008 - t * t * 0.024);
      const cz = 0.044 + t * 0.028;
      const rx = 0.028 * (1 - t * 0.38);
      const rz = 0.046 * (1 - t * 0.35);
      return { cx, cy: y, cz, rx, rz };
    });
  }

  // ---------------------------------------------------------------------------
  // 5. COMBAT TROUSERS, DROP-LEG HOLSTER, KNEE PADS & TACTICAL BOOTS
  // ---------------------------------------------------------------------------
  for (let side = -1; side <= 1; side += 2) {
    sampleLimb(64, 30, (t) => {
      const y = 0.02 - t * 1.00;
      // Wide, grounded tactical stance
      const cx = side * (0.128 + t * 0.042 + Math.sin(t * Math.PI) * 0.012);
      const kneeBulge = Math.exp(-Math.pow((t - 0.49) / 0.09, 2)) * 0.018;
      const cz = -0.006 + kneeBulge - Math.exp(-Math.pow((t - 0.72) / 0.16, 2)) * 0.014;
      const cargoPocket = Math.exp(-Math.pow((t - 0.24) / 0.11, 2)) * 0.014;
      const r = (t < 0.5 ? 0.114 - t * 0.052 : 0.088 - (t - 0.5) * 0.036) + cargoPocket;
      return { cx, cy: y, cz, rx: r * 0.98, rz: r * 1.04 };
    });

    // Molded knee pad on front of each leg
    sampleBoxSurface(side * 0.155, -0.47, 0.096, 0.042, 0.048, 0.018, 0.011);

    // Rugged combat boot (heel to toe box)
    const bootSteps = 16;
    const bootSegs = 20;
    for (let f = 0; f <= bootSteps; f++) {
      const t = f / bootSteps;
      const z = -0.058 + t * 0.205;
      const height = 0.072 * Math.pow(1 - t * 0.55, 1.1) + 0.024;
      const width = 0.048 + 0.016 * Math.sin(t * Math.PI * 0.85);
      const cx = side * (0.170 + t * 0.018);
      const baseY = -1.075;
      for (let s = 0; s < bootSegs; s++) {
        const a = (s / bootSegs) * Math.PI * 2;
        pushPt(
          cx + Math.cos(a) * width,
          baseY + (Math.sin(a) * 0.5 + 0.5) * height,
          z,
          0.0014,
        );
      }
    }
  }

  // Right-thigh tactical drop-leg holster (iconic special-ops asymmetry)
  sampleBoxSurface(-0.245, -0.18, 0.018, 0.032, 0.082, 0.042, 0.012);

  const normalized = normalizeAvatarPointCloud(new Float32Array(raw));
  return buildCellularPointCloud(normalized.positions, {
    minSpacing: options.minSpacing ?? 0.0145,
    maxPoints: options.maxPoints ?? 15800,
    seed: options.seed ?? 4207,
    isFullBody: true,
  });
}
