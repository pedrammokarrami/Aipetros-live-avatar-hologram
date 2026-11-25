import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCellularPointCloud,
  computeAnatomicalWeights,
  generateProceduralFullBodyHuman,
  generateProceduralTacticalSoldier,
  normalizeAvatarPointCloud,
} from './pointCloud';

test('normalizeAvatarPointCloud preserves full-body meshes without cropping legs and centers them', () => {
  // Full-body mesh: width 0.5, height 1.8 (aspect ratio 3.6 > 1.72)
  const raw: number[] = [];
  for (let i = 0; i < 400; i++) {
    const t = i / 399;
    const x = ((i % 10) / 9 - 0.5) * 0.5 + 3.0;
    const y = t * 1.8 - 0.9;
    const z = (((i * 7) % 10) / 9 - 0.5) * 0.3 - 2.0;
    raw.push(x, y, z);
  }

  const result = normalizeAvatarPointCloud(new Float32Array(raw));
  assert.equal(result.isFullBody, true);
  // All 400 vertices preserved (no upper-body crop!)
  assert.equal(result.positions.length / 3, 400);
  const midX = (result.bounds.minX + result.bounds.maxX) * 0.5;
  const midZ = (result.bounds.minZ + result.bounds.maxZ) * 0.5;
  assert.ok(Math.abs(midX) < 0.01, `Expected centered X, got ${midX}`);
  assert.ok(Math.abs(midZ) < 0.01, `Expected centered Z, got ${midZ}`);
});

test('normalizeAvatarPointCloud detects upper-body bust aspect ratio cleanly', () => {
  const raw: number[] = [];
  for (let i = 0; i < 200; i++) {
    raw.push(((i % 10) / 9 - 0.5) * 0.65, (i / 199) * 0.85, (((i * 3) % 10) / 9 - 0.5) * 0.35);
  }
  const result = normalizeAvatarPointCloud(new Float32Array(raw));
  assert.equal(result.isFullBody, false);
  assert.equal(result.positions.length / 3, 200);
});

test('buildCellularPointCloud spatially thins dense duplicate clusters and caps count', () => {
  const clumped = new Float32Array(2000 * 3);
  for (let i = 0; i < 2000; i++) {
    clumped[i * 3] = (i % 5) * 0.001;
    clumped[i * 3 + 1] = ((i * 3) % 5) * 0.001;
    clumped[i * 3 + 2] = ((i * 7) % 5) * 0.001;
  }

  const cloud = buildCellularPointCloud(clumped, { minSpacing: 0.03, maxPoints: 500, seed: 42 });
  assert.ok(cloud.count <= 8, `Expected tight cluster to thin dramatically, got ${cloud.count}`);
  assert.equal(cloud.positions.length, cloud.count * 3);
});

test('computeAnatomicalWeights localizes mouth and jaw weights on full-body humans', () => {
  const bounds = {
    minX: -0.35,
    maxX: 0.35,
    minY: -1.08,
    maxY: 1.08,
    minZ: -0.14,
    maxZ: 0.16,
    width: 0.7,
    height: 2.16,
    depth: 0.3,
  };

  // Full-body mouth center: ny ~ 0.903 => y = -1.08 + 2.16 * 0.903 = 0.8705
  const mouth = computeAnatomicalWeights(0, 0.8705, 0.14, bounds, true);
  // Knee point: y = -0.5, x = 0.1, z = 0.05
  const knee = computeAnatomicalWeights(0.1, -0.5, 0.05, bounds, true);
  // Back of head: y = 0.8705, x = 0, z = -0.12
  const backHead = computeAnatomicalWeights(0, 0.8705, -0.12, bounds, true);

  assert.ok(mouth.mouthWeight > 0.7, `Expected high mouthWeight at mouth, got ${mouth.mouthWeight}`);
  assert.ok(knee.mouthWeight < 0.01, 'Knee should have near-zero mouthWeight');
  assert.ok(backHead.mouthWeight < 0.05, 'Back of head should have near-zero mouthWeight');
});

test('generateProceduralFullBodyHuman produces full-body standing human with lip-sync weights', () => {
  const human = generateProceduralFullBodyHuman({ maxPoints: 9400, minSpacing: 0.02 });
  assert.equal(human.isFullBody, true);
  assert.ok(human.count >= 3500 && human.count <= 9400, `Unexpected point count: ${human.count}`);
  assert.ok(human.bounds.height > 1.9 && human.bounds.height < 2.4);
  // Full body aspect ratio (height / width) should be clearly human standing (> 2.2)
  assert.ok(
    human.bounds.height / human.bounds.width > 2.2,
    `Expected full-body aspect ratio > 2.2, got ${human.bounds.height / human.bounds.width}`,
  );

  let maxMouth = 0;
  let maxJaw = 0;
  for (let i = 0; i < human.count; i++) {
    if (human.mouthWeights[i] > maxMouth) maxMouth = human.mouthWeights[i];
    if (human.jawWeights[i] > maxJaw) maxJaw = human.jawWeights[i];
  }
  assert.ok(maxMouth > 0.65, `Full-body human should have mouth lip-sync weights, got ${maxMouth}`);
  assert.ok(maxJaw > 0.65, `Full-body human should have jaw lip-sync weights, got ${maxJaw}`);
});

test('generateProceduralTacticalSoldier produces dense full-body tactical soldier with lip-sync weights', () => {
  const soldier = generateProceduralTacticalSoldier({ maxPoints: 15800, minSpacing: 0.0145 });
  assert.equal(soldier.isFullBody, true);
  assert.ok(soldier.count >= 6000 && soldier.count <= 15800, `Unexpected soldier point count: ${soldier.count}`);
  assert.ok(soldier.bounds.height > 1.9 && soldier.bounds.height < 2.4);

  let maxMouth = 0;
  let maxJaw = 0;
  for (let i = 0; i < soldier.count; i++) {
    if (soldier.mouthWeights[i] > maxMouth) maxMouth = soldier.mouthWeights[i];
    if (soldier.jawWeights[i] > maxJaw) maxJaw = soldier.jawWeights[i];
  }
  assert.ok(maxMouth > 0.55, `Soldier should have visor/mouth lip-sync weights, got ${maxMouth}`);
  assert.ok(maxJaw > 0.55, `Soldier should have jaw lip-sync weights, got ${maxJaw}`);
});
