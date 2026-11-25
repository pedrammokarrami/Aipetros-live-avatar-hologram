import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  buildCellularPointCloud,
  createSeededRandom,
  normalizeAvatarPointCloud,
  type PointCloudData,
} from './pointCloud';

export interface LoadedGlbPointCloud {
  cloud: PointCloudData;
  fileName: string;
  isFullBody: boolean;
}

const _vA = new THREE.Vector3();
const _vB = new THREE.Vector3();
const _vC = new THREE.Vector3();
const _edge1 = new THREE.Vector3();
const _edge2 = new THREE.Vector3();
const _cross = new THREE.Vector3();

/**
 * Samples evenly distributed points across mesh triangles if a GLB has sparse topology,
 * or extracts world-space vertices directly when already dense, then filters to upper body
 * and applies spatial cellular thinning.
 */
function extractWorldPositionsFromScene(root: THREE.Object3D): Float32Array {
  root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  let totalVertices = 0;

  root.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const posAttr = mesh.geometry?.getAttribute('position');
      if (posAttr && posAttr.count > 0) {
        meshes.push(mesh);
        totalVertices += posAttr.count;
      }
    }
  });

  if (meshes.length === 0 || totalVertices === 0) {
    throw new Error('No valid 3D mesh geometry was found inside this file.');
  }

  const rawPoints: number[] = [];
  const rand = createSeededRandom(9001);

  // If the mesh has fewer than 18,000 vertices, perform area-weighted triangle surface sampling
  // so low-poly models still render as a crisp, finely detailed cellular hologram.
  const shouldSurfaceSample = totalVertices < 18000;

  if (shouldSurfaceSample) {
    // Compute total surface area across all meshes first
    interface TriRecord {
      ax: number;
      ay: number;
      az: number;
      bx: number;
      by: number;
      bz: number;
      cx: number;
      cy: number;
      cz: number;
      cumulativeArea: number;
    }

    const tris: TriRecord[] = [];
    let totalArea = 0;

    for (const mesh of meshes) {
      const geom = mesh.geometry;
      const pos = geom.getAttribute('position');
      const idx = geom.getIndex();
      const mat = mesh.matrixWorld;

      const triCount = idx ? Math.floor(idx.count / 3) : Math.floor(pos.count / 3);
      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3) : t * 3;
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;

        _vA.fromBufferAttribute(pos, i0).applyMatrix4(mat);
        _vB.fromBufferAttribute(pos, i1).applyMatrix4(mat);
        _vC.fromBufferAttribute(pos, i2).applyMatrix4(mat);

        _edge1.subVectors(_vB, _vA);
        _edge2.subVectors(_vC, _vA);
        const area = 0.5 * _cross.crossVectors(_edge1, _edge2).length();
        if (area <= 1e-10 || !Number.isFinite(area)) continue;

        totalArea += area;
        tris.push({
          ax: _vA.x,
          ay: _vA.y,
          az: _vA.z,
          bx: _vB.x,
          by: _vB.y,
          bz: _vB.z,
          cx: _vC.x,
          cy: _vC.y,
          cz: _vC.z,
          cumulativeArea: totalArea,
        });
      }
    }

    if (tris.length > 0 && totalArea > 0) {
      const targetSamples = 46000;
      for (let s = 0; s < targetSamples; s++) {
        const r = rand() * totalArea;
        // Binary search cumulative area
        let lo = 0;
        let hi = tris.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (tris[mid].cumulativeArea < r) lo = mid + 1;
          else hi = mid;
        }
        const tri = tris[lo];
        let u = rand();
        let v = rand();
        if (u + v > 1) {
          u = 1 - u;
          v = 1 - v;
        }
        const w = 1 - u - v;
        rawPoints.push(
          w * tri.ax + u * tri.bx + v * tri.cx,
          w * tri.ay + u * tri.by + v * tri.cy,
          w * tri.az + u * tri.bz + v * tri.cz,
        );
      }
      return new Float32Array(rawPoints);
    }
  }

  // Dense mesh path: extract vertices directly (with stride cap for massive 500k+ scans)
  const stride = Math.max(1, Math.floor(totalVertices / 140000));
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    const mat = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i += stride) {
      _vA.fromBufferAttribute(pos, i).applyMatrix4(mat);
      if (Number.isFinite(_vA.x) && Number.isFinite(_vA.y) && Number.isFinite(_vA.z)) {
        rawPoints.push(_vA.x, _vA.y, _vA.z);
      }
    }
  }

  return new Float32Array(rawPoints);
}

/**
 * Parses a raw .glb/.gltf ArrayBuffer into a normalized, spatially thinned
 * full-body or upper-body cellular point cloud.
 */
async function parseGlbArrayBufferToPointCloud(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<LoadedGlbPointCloud> {
  if (buffer.byteLength < 12) {
    throw new Error('This 3D model file appears empty or corrupted.');
  }

  const loader = new GLTFLoader();
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    loader.parse(
      buffer,
      '',
      (parsed) => resolve(parsed),
      (err) => {
        const msg = err instanceof Error ? err.message : 'Unable to parse 3D model.';
        reject(new Error(`Could not load ${fileName}: ${msg}`));
      },
    );
  });

  const rawPositions = extractWorldPositionsFromScene(gltf.scene);

  // Dispose temporary parsed geometries/materials immediately to avoid memory leaks
  gltf.scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const m = obj as THREE.Mesh;
      m.geometry?.dispose();
      if (Array.isArray(m.material)) {
        m.material.forEach((mat) => mat.dispose());
      } else {
        m.material?.dispose();
      }
    }
  });

  const normalized = normalizeAvatarPointCloud(rawPositions);
  const cloud = buildCellularPointCloud(normalized.positions, {
    minSpacing: normalized.isFullBody ? 0.0125 : 0.014,
    maxPoints: 22000,
    seed: 4042,
    isFullBody: normalized.isFullBody,
  });

  if (cloud.count < 20) {
    throw new Error('Not enough point geometry could be extracted from this model.');
  }

  return {
    cloud,
    fileName,
    isFullBody: normalized.isFullBody,
  };
}

/**
 * Parses a local .glb or .gltf File into a normalized, spatially thinned
 * full-body or upper-body cellular point cloud.
 */
export async function loadGlbFileToPointCloud(file: File): Promise<LoadedGlbPointCloud> {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.glb') && !lowerName.endsWith('.gltf')) {
    throw new Error('Please choose a valid .glb or .gltf 3D model file.');
  }

  const buffer = await file.arrayBuffer();
  return parseGlbArrayBufferToPointCloud(buffer, file.name);
}

/**
 * Fetches a .glb or .gltf model from an API/CDN URL and converts it into
 * the crisp half-size cellular holographic point cloud.
 */
export async function loadGlbUrlToPointCloud(url: string): Promise<LoadedGlbPointCloud> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Unable to fetch 3D model from API (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  const cleanName = url.split('?')[0].split('/').pop() || 'avatar.glb';
  return parseGlbArrayBufferToPointCloud(buffer, cleanName);
}
