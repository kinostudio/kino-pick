import {
  inspectImageHeader,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_HEADER_BYTES,
  MAX_IMAGE_PIXELS,
} from '../../../packages/contracts/src/image-metadata.ts';
import { isAnimatedOrMultiImage } from '../../../packages/image-processing/src/image-container.ts';

const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const THUMBNAIL_EDGE = 320;
const PREVIEW_EDGE = 2048;
const JPEG_QUALITY = 0.82;

type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type BrowserImageProcessingErrorCode =
  | 'source_too_large'
  | 'unsupported_format'
  | 'animated_image'
  | 'dimensions_exceeded'
  | 'invalid_image'
  | 'decode_failed'
  | 'canvas_unavailable'
  | 'encoding_failed'
  | 'output_too_large';

export class BrowserImageProcessingError extends Error {
  constructor(
    readonly code: BrowserImageProcessingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BrowserImageProcessingError';
  }
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type CanvasContext =
  OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function supportedMime(value: string): value is SupportedImageMime {
  return (
    value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
  );
}

function headerErrorCode(error: unknown): BrowserImageProcessingErrorCode {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'IMAGE_DIMENSIONS_EXCEEDED'
  )
    return 'dimensions_exceeded';
  return 'invalid_image';
}

async function inspectSource(
  file: Blob,
  mime: SupportedImageMime,
): Promise<{ width: number; height: number }> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new BrowserImageProcessingError(
      'invalid_image',
      'Source image could not be read',
    );
  }

  try {
    const dimensions = inspectImageHeader(
      bytes.subarray(0, Math.min(bytes.byteLength, MAX_IMAGE_HEADER_BYTES)),
      mime,
      file.size,
    );
    if (isAnimatedOrMultiImage(bytes, mime))
      throw new BrowserImageProcessingError(
        'animated_image',
        'Animated and multi-image sources are not supported',
      );
    return dimensions;
  } catch (error) {
    if (error instanceof BrowserImageProcessingError) throw error;
    const code = headerErrorCode(error);
    throw new BrowserImageProcessingError(
      code,
      code === 'dimensions_exceeded'
        ? 'Source image dimensions exceed the supported limits'
        : 'Source image format or header is invalid',
    );
  }
}

function validateDimensions(width: number, height: number) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION ||
    width * height > MAX_IMAGE_PIXELS
  )
    throw new BrowserImageProcessingError(
      'dimensions_exceeded',
      'Decoded image dimensions exceed the supported limits',
    );
}

function outputSize(width: number, height: number, edge: number) {
  const scale = Math.min(1, edge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function createCanvas(width: number, height: number) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d', { alpha: false });
      if (context && typeof canvas.convertToBlob === 'function')
        return { canvas: canvas as Canvas, context: context as CanvasContext };
      canvas.width = 0;
      canvas.height = 0;
    } catch {
      // Use the DOM canvas fallback when OffscreenCanvas is unavailable here.
    }
  }

  if (typeof document === 'undefined')
    throw new BrowserImageProcessingError(
      'canvas_unavailable',
      'No supported canvas is available',
    );

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    throw new BrowserImageProcessingError(
      'canvas_unavailable',
      'A 2D canvas context could not be created',
    );
  }
  return { canvas: canvas as Canvas, context: context as CanvasContext };
}

async function encodeJpeg(canvas: Canvas): Promise<Blob> {
  let output: Blob | null;
  try {
    const offscreen = canvas as OffscreenCanvas;
    if (typeof offscreen.convertToBlob === 'function') {
      output = await offscreen.convertToBlob({
        type: 'image/jpeg',
        quality: JPEG_QUALITY,
      });
    } else {
      const htmlCanvas = canvas as HTMLCanvasElement;
      if (typeof htmlCanvas.toBlob !== 'function')
        throw new Error('Canvas encoding is unavailable');
      output = await new Promise<Blob | null>((resolve, reject) => {
        try {
          htmlCanvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
        } catch (error) {
          reject(error);
        }
      });
    }
  } catch {
    throw new BrowserImageProcessingError(
      'encoding_failed',
      'JPEG derivative could not be encoded',
    );
  }

  if (!output || output.type !== 'image/jpeg' || output.size < 1)
    throw new BrowserImageProcessingError(
      'encoding_failed',
      'JPEG derivative could not be encoded',
    );
  if (output.size > MAX_OUTPUT_BYTES)
    throw new BrowserImageProcessingError(
      'output_too_large',
      'Generated image exceeds the output size limit',
    );
  return output;
}

async function renderDerivative(
  bitmap: ImageBitmap,
  edge: number,
): Promise<Blob> {
  const dimensions = outputSize(bitmap.width, bitmap.height, edge);
  const { canvas, context } = createCanvas(dimensions.width, dimensions.height);
  try {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, dimensions.width, dimensions.height);
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    const output = await encodeJpeg(canvas);
    if (output.size > (edge === THUMBNAIL_EDGE ? 512 * 1024 : 4 * 1024 * 1024))
      throw new BrowserImageProcessingError(
        'output_too_large',
        'Generated image exceeds the upload budget',
      );
    return output;
  } catch (error) {
    if (error instanceof BrowserImageProcessingError) throw error;
    throw new BrowserImageProcessingError(
      'encoding_failed',
      'JPEG derivative could not be rendered',
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function generateBrowserDerivatives(
  file: Blob,
): Promise<{ thumbnail: Blob; preview: Blob }> {
  if (!Number.isSafeInteger(file.size) || file.size < 1)
    throw new BrowserImageProcessingError(
      'invalid_image',
      'Source image is empty or invalid',
    );
  if (file.size > MAX_SOURCE_BYTES)
    throw new BrowserImageProcessingError(
      'source_too_large',
      'Source image exceeds the input size limit',
    );
  if (!supportedMime(file.type))
    throw new BrowserImageProcessingError(
      'unsupported_format',
      'Only JPEG, PNG, and WebP images are supported',
    );

  const encodedDimensions = await inspectSource(file, file.type);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new BrowserImageProcessingError(
      'decode_failed',
      'Source image could not be decoded',
    );
  }

  try {
    validateDimensions(bitmap.width, bitmap.height);
    const sameDimensions =
      bitmap.width === encodedDimensions.width &&
      bitmap.height === encodedDimensions.height;
    const orientedDimensions =
      bitmap.width === encodedDimensions.height &&
      bitmap.height === encodedDimensions.width;
    if (!sameDimensions && !orientedDimensions)
      throw new BrowserImageProcessingError(
        'invalid_image',
        'Decoded dimensions do not match the source header',
      );

    const thumbnail = await renderDerivative(bitmap, THUMBNAIL_EDGE);
    const preview = await renderDerivative(bitmap, PREVIEW_EDGE);
    return { thumbnail, preview };
  } finally {
    bitmap.close();
  }
}
