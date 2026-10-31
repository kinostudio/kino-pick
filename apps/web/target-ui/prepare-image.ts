import {
  inspectImageHeader,
  MAX_IMAGE_HEADER_BYTES,
} from '../../../packages/contracts/src/image-metadata';

export const MAX_BROWSER_UPLOAD_BYTES = 64 * 1024 * 1024;
export const LOCAL_PREVIEW_MAX_DIMENSION = 320;

export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageLimits = Readonly<{
  maxBrowserBytes: number;
  maxPixels: number;
  maxDimension: number;
}>;

export type PreparedImage = Readonly<{
  contentType: SupportedImageType;
  encodedWidth: number;
  encodedHeight: number;
  width: number;
  height: number;
  sha256: string;
  previewUrl: string;
}>;

export class ImagePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePreparationError';
  }
}

const typeByExtension: Readonly<Record<string, SupportedImageType>> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function getContentType(file: File): SupportedImageType {
  if (
    file.type === 'image/jpeg' ||
    file.type === 'image/png' ||
    file.type === 'image/webp'
  )
    return file.type;
  if (file.type) {
    throw new ImagePreparationError('僅支援 JPEG、PNG 與 WebP 照片。');
  }
  const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
  const inferred = typeByExtension[extension];
  if (!inferred)
    throw new ImagePreparationError(
      '無法判斷照片格式，請選擇 JPEG、PNG 或 WebP 檔案。',
    );
  return inferred;
}

function validateFilename(file: File) {
  const name = file.name;
  if (
    name.trim().length === 0 ||
    name.length > 255 ||
    /[\\/\u0000-\u001f\u007f]/.test(name)
  )
    throw new ImagePreparationError('檔名無法安全使用，請先重新命名後再加入。');
}

function validateDimensions(
  width: number,
  height: number,
  limits: ImageLimits,
) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > limits.maxDimension ||
    height > limits.maxDimension ||
    width * height > limits.maxPixels
  )
    throw new ImagePreparationError(
      '照片尺寸超出目前可處理範圍，尚未開始上傳。',
    );
}

function bytesToHex(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += byte.toString(16).padStart(2, '0');
  return value;
}

async function sha256(file: File) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await file.arrayBuffer(),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function previewBlob(bitmap: ImageBitmap) {
  const scale = Math.min(
    1,
    LOCAL_PREVIEW_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context)
    throw new ImagePreparationError('目前無法建立照片預覽，請改用其他瀏覽器。');
  context.drawImage(bitmap, 0, 0, width, height);
  try {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.78),
    );
    if (!blob)
      throw new ImagePreparationError('目前無法建立照片預覽，請稍後再試。');
    return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export async function prepareImage(
  file: File,
  limits: ImageLimits,
): Promise<PreparedImage> {
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    throw new ImagePreparationError('檔案內容是空的，請選擇有效照片。');
  const maxBrowserBytes = Math.min(
    limits.maxBrowserBytes,
    MAX_BROWSER_UPLOAD_BYTES,
  );
  if (file.size > maxBrowserBytes) {
    const maxMiB = maxBrowserBytes / (1024 * 1024);
    const maxMiBLabel = Number.isInteger(maxMiB)
      ? String(maxMiB)
      : maxMiB.toFixed(1);
    throw new ImagePreparationError(`單張照片不可超過 ${maxMiBLabel} MiB。`);
  }
  validateFilename(file);
  const contentType = getContentType(file);

  let encodedDimensions: { width: number; height: number };
  try {
    const header = new Uint8Array(
      await file
        .slice(0, Math.min(file.size, MAX_IMAGE_HEADER_BYTES))
        .arrayBuffer(),
    );
    encodedDimensions = inspectImageHeader(header, contentType, file.size);
    validateDimensions(
      encodedDimensions.width,
      encodedDimensions.height,
      limits,
    );
  } catch (error) {
    if (error instanceof ImagePreparationError) throw error;
    const code = error instanceof Error ? error.message : '';
    if (code === 'IMAGE_DIMENSIONS_EXCEEDED')
      throw new ImagePreparationError(
        '照片尺寸超出目前可處理範圍，尚未開始上傳。',
      );
    if (code === 'IMAGE_HEADER_LIMIT')
      throw new ImagePreparationError(
        '照片標頭超出可檢查範圍，請先重新匯出照片後再試。',
      );
    throw new ImagePreparationError(
      '無法讀取照片格式或尺寸，請確認檔案完整且未受損。',
    );
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new ImagePreparationError(
      '瀏覽器無法解碼這張照片，請確認檔案完整且格式受支援。',
    );
  }

  try {
    validateDimensions(bitmap.width, bitmap.height, limits);
    if (
      bitmap.width * bitmap.height !==
      encodedDimensions.width * encodedDimensions.height
    )
      throw new ImagePreparationError(
        '照片標示的尺寸與實際解碼結果不一致，尚未開始上傳。',
      );

    let digest: string;
    try {
      digest = await sha256(file);
    } catch {
      throw new ImagePreparationError('目前無法安全檢查照片，請稍後再試。');
    }

    let preview: Blob;
    try {
      preview = await previewBlob(bitmap);
    } catch (error) {
      if (error instanceof ImagePreparationError) throw error;
      throw new ImagePreparationError(
        '目前無法建立照片預覽，請改用其他瀏覽器。',
      );
    }

    return {
      contentType,
      encodedWidth: encodedDimensions.width,
      encodedHeight: encodedDimensions.height,
      width: bitmap.width,
      height: bitmap.height,
      sha256: digest,
      previewUrl: URL.createObjectURL(preview),
    };
  } finally {
    bitmap.close();
  }
}
