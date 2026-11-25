import { createSeededRandom } from './pointCloud';

export interface BackgroundPointCloudData {
  positions: Float32Array;
  seeds: Float32Array;
  scales: Float32Array;
  intensities: Float32Array;
  colors: Float32Array;
  count: number;
}

export interface BackgroundCloudOptions {
  /** Maximum cellular points to retain after spatial thinning. */
  maxPoints?: number;
  /** Minimum 3D spacing between background cells. */
  minSpacing?: number;
  /** Deterministic PRNG seed. */
  seed?: number;
}

/**
 * Converts raw RGBA image pixels into a 3D depth-displaced holographic cellular point-cloud
 * environment (matching the exact cellular visual language of .GLB holograms), engineered
 * to sit gracefully behind the full-body avatar at very low luminance so the avatar stands out.
 */
export function buildImageBackgroundPointCloud(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: BackgroundCloudOptions = {},
): BackgroundPointCloudData {
  const maxPoints = options.maxPoints ?? 13500;
  let spacing = options.minSpacing ?? 0.036;
  const rand = createSeededRandom(options.seed ?? 7711);

  if (width < 2 || height < 2 || rgba.length < width * height * 4) {
    return {
      positions: new Float32Array(0),
      seeds: new Float32Array(0),
      scales: new Float32Array(0),
      intensities: new Float32Array(0),
      colors: new Float32Array(0),
      count: 0,
    };
  }

  // Precompute normalized luminance grid for Sobel edge detection & 3D depth relief
  const lumaGrid = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const r = rgba[o] / 255;
    const g = rgba[o + 1] / 255;
    const b = rgba[o + 2] / 255;
    const a = rgba[o + 3] / 255;
    lumaGrid[i] = (0.299 * r + 0.587 * g + 0.114 * b) * a;
  }

  // Panoramic curved 3D stage behind the avatar
  const aspect = Math.max(0.5, Math.min(2.4, width / height));
  const stageHeight = 4.6;
  const stageWidth = Math.min(9.2, Math.max(5.4, stageHeight * aspect));

  interface CandidatePoint {
    x: number;
    y: number;
    z: number;
    intensity: number;
    r: number;
    g: number;
    b: number;
    scale: number;
  }

  const candidates: CandidatePoint[] = [];

  for (let py = 0; py < height; py++) {
    const v = 1 - py / (height - 1); // 0 = bottom, 1 = top
    for (let px = 0; px < width; px++) {
      const u = px / (width - 1); // 0 = left, 1 = right
      const idx = py * width + px;
      const luma = lumaGrid[idx];

      // Local gradient magnitude (preserves architectural/subject contours like a 3D LiDAR scan)
      const xL = Math.max(0, px - 1);
      const xR = Math.min(width - 1, px + 1);
      const yU = Math.max(0, py - 1);
      const yD = Math.min(height - 1, py + 1);
      const gx = lumaGrid[py * width + xR] - lumaGrid[py * width + xL];
      const gy = lumaGrid[yD * width + px] - lumaGrid[yU * width + px];
      const edge = Math.min(1, Math.hypot(gx, gy) * 3.1);

      // Skip pitch-black empty pixels so the 3D space stays airy and holographic
      if (luma < 0.045 && edge < 0.07) continue;

      const o = idx * 4;
      const sr = rgba[o] / 255;
      const sg = rgba[o + 1] / 255;
      const sb = rgba[o + 2] / 255;

      // Subtle holographic cyan unification (70% deep space-cyan, 30% original photo chroma)
      const cr = sr * 0.30 + 0.10 * 0.70;
      const cg = sg * 0.30 + 0.76 * 0.70;
      const cb = sb * 0.30 + 0.96 * 0.70;

      // Curved panoramic 3D geometry wrapping gently around behind the avatar
      const nx = (u - 0.5) * 2; // -1..1
      const ny = (v - 0.5) * 2; // -1..1
      const curveAngle = nx * 0.58; // gentle concave holographic dome
      const baseRadius = stageWidth * 0.86;

      const jitterX = (rand() - 0.5) * 0.015;
      const jitterY = (rand() - 0.5) * 0.015;
      const jitterZ = (rand() - 0.5) * 0.022;

      const x = Math.sin(curveAngle) * baseRadius + jitterX;
      const y = ny * (stageHeight * 0.5) + 0.05 + jitterY;

      // 3D depth relief: foreground bottom & luminous/edge structures protrude gently forward,
      // while ALWAYS remaining safely behind the full-body avatar (z <= -0.95)
      const curveZ = -2.55 + (1 - Math.cos(curveAngle)) * 1.45;
      const depthRelief = luma * 0.62 + edge * 0.34 + (1 - v) * 0.24;
      const z = Math.min(-0.98, curveZ + depthRelief + jitterZ);

      // Combine luminance and strong architectural edge contour into soft intensity in [0.16, 1.0]
      const intensity = Math.max(0.16, Math.min(1, luma * 0.48 + edge * 0.85));
      const scale = 0.64 + edge * 0.34 + rand() * 0.22;

      candidates.push({ x, y, z, intensity, r: cr, g: cg, b: cb, scale });
    }
  }

  if (candidates.length === 0) {
    return {
      positions: new Float32Array(0),
      seeds: new Float32Array(0),
      scales: new Float32Array(0),
      intensities: new Float32Array(0),
      colors: new Float32Array(0),
      count: 0,
    };
  }

  // Deterministic Fisher-Yates shuffle + adaptive 3D voxel thinning for uniform crisp cells
  const order = new Uint32Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) order[i] = i;
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }

  let chosen: number[] = [];
  for (let attempt = 0; attempt < 6; attempt++) {
    const occupied = new Set<string>();
    const kept: number[] = [];
    const inv = 1 / spacing;

    for (let k = 0; k < order.length; k++) {
      const idx = order[k];
      const p = candidates[idx];
      const key = `${Math.floor(p.x * inv)},${Math.floor(p.y * inv)},${Math.floor(p.z * inv)}`;
      if (!occupied.has(key)) {
        occupied.add(key);
        kept.push(idx);
      }
    }

    chosen = kept;
    if (kept.length <= maxPoints) break;
    const ratio = Math.cbrt(kept.length / maxPoints);
    spacing *= Math.max(1.12, ratio * 1.05);
  }

  if (chosen.length > maxPoints) {
    chosen = chosen.slice(0, maxPoints);
  }

  const count = chosen.length;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const intensities = new Float32Array(count);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const p = candidates[chosen[i]];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;

    seeds[i * 3] = rand() * Math.PI * 2;
    seeds[i * 3 + 1] = 0.35 + rand() * 0.55;
    seeds[i * 3 + 2] = 0.6 + rand() * 0.7;

    scales[i] = p.scale;
    intensities[i] = p.intensity;
    colors[i * 3] = p.r;
    colors[i * 3 + 1] = p.g;
    colors[i * 3 + 2] = p.b;
  }

  return {
    positions,
    seeds,
    scales,
    intensities,
    colors,
    count,
  };
}
