import test from 'node:test';
import assert from 'node:assert/strict';
import { buildImageBackgroundPointCloud } from './backgroundPointCloud';

test('buildImageBackgroundPointCloud converts RGBA photo into curved 3D point cloud behind avatar', () => {
  const w = 64;
  const h = 48;
  const rgba = new Uint8ClampedArray(w * h * 4);

  // Synthetic horizon + bright architectural silhouette
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const isBuilding = y > 18 && x > 14 && x < 50;
      const isHorizon = Math.abs(y - 24) < 2;
      rgba[i] = isBuilding ? 140 : isHorizon ? 220 : 40;
      rgba[i + 1] = isBuilding ? 190 : isHorizon ? 240 : 75;
      rgba[i + 2] = isBuilding ? 235 : isHorizon ? 255 : 130;
      rgba[i + 3] = 255;
    }
  }

  const cloud = buildImageBackgroundPointCloud(rgba, w, h, { maxPoints: 3000, minSpacing: 0.06 });
  assert.ok(cloud.count > 200 && cloud.count <= 3000, `Unexpected background cloud count: ${cloud.count}`);
  assert.equal(cloud.positions.length, cloud.count * 3);
  assert.equal(cloud.colors.length, cloud.count * 3);

  // Every background point must remain safely behind the foreground human avatar (z <= -0.95)
  let maxZ = -Infinity;
  let minZ = Infinity;
  for (let i = 0; i < cloud.count; i++) {
    const z = cloud.positions[i * 3 + 2];
    if (z > maxZ) maxZ = z;
    if (z < minZ) minZ = z;
  }
  assert.ok(maxZ <= -0.95, `Background cloud should sit behind avatar, found z=${maxZ}`);
  assert.ok(maxZ - minZ > 0.25, `Background cloud should have genuine 3D depth relief, got span ${maxZ - minZ}`);
});

test('buildImageBackgroundPointCloud skips pitch-black pixels cleanly', () => {
  const rgba = new Uint8ClampedArray(16 * 16 * 4); // all zeros
  const cloud = buildImageBackgroundPointCloud(rgba, 16, 16);
  assert.equal(cloud.count, 0);
});
