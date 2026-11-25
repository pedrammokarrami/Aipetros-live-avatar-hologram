import {
  buildImageBackgroundPointCloud,
  type BackgroundPointCloudData,
} from './backgroundPointCloud';

export interface LoadedBackgroundCloud {
  cloud: BackgroundPointCloudData;
  fileName: string;
}

const VALID_IMAGE_EXTENSIONS = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

function decodeImageToBackgroundCloud(
  img: HTMLImageElement,
  fileName: string,
): LoadedBackgroundCloud {
  const natW = img.naturalWidth || img.width;
  const natH = img.naturalHeight || img.height;
  if (natW < 2 || natH < 2) {
    throw new Error('Image dimensions are too small to project.');
  }

  // Downsample to a crisp ~210px max dimension grid for fine-grained 3D architectural point reconstruction
  const maxDim = 210;
  const scale = Math.min(1, maxDim / Math.max(natW, natH));
  const sampleW = Math.max(16, Math.round(natW * scale));
  const sampleH = Math.max(16, Math.round(natH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to read image pixels in this browser.');
  }

  ctx.drawImage(img, 0, 0, sampleW, sampleH);
  const { data } = ctx.getImageData(0, 0, sampleW, sampleH);

  const cloud = buildImageBackgroundPointCloud(data, sampleW, sampleH, {
    maxPoints: 13500,
    minSpacing: 0.036,
    seed: 7711,
  });

  if (cloud.count < 24) {
    throw new Error('This image is too dark or uniform to build a 3D point-cloud scene.');
  }

  return {
    cloud,
    fileName,
  };
}

/**
 * Loads a local or bundled image URL and converts it into a dim, fine-grained
 * 3D holographic cellular point-cloud environment.
 */
export async function loadImageUrlToBackgroundCloud(
  imageUrl: string,
  label = 'CS2 World',
): Promise<LoadedBackgroundCloud> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`Could not load background image ${label}.`));
    el.src = imageUrl;
  });
  return decodeImageToBackgroundCloud(img, label);
}

/**
 * Decodes a user-selected or dropped photo into an offscreen 2D canvas, downsamples cleanly
 * to a crisp depth-sampling grid, and converts it into a dim 3D holographic cellular point cloud.
 */
export async function loadImageFileToBackgroundCloud(file: File): Promise<LoadedBackgroundCloud> {
  const isImageMime = file.type.startsWith('image/');
  const isImageExt = VALID_IMAGE_EXTENSIONS.test(file.name);
  if (!isImageMime && !isImageExt) {
    throw new Error('Please select a valid image file (PNG, JPG, or WebP).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Could not decode image ${file.name}.`));
      el.src = objectUrl;
    });

    return decodeImageToBackgroundCloud(img, file.name);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
