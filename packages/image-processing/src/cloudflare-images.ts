import { z } from 'zod';
import type {
  ImageProcessingAdapter,
  ImageProcessingInput,
  ImageProcessingResult,
  ProcessedImageArtifact,
} from '../../domain/src/index.ts';
import {
  inspectImageHeader,
  MAX_IMAGE_HEADER_BYTES,
} from '../../contracts/src/image-metadata.ts';
import { isAnimatedOrMultiImage } from './image-container.ts';

export const CLOUDFLARE_IMAGES_PROCESSOR_VERSION =
  'cloudflare-images-jpeg-82-v1';
// Internal memory budget; this is not a claim about the provider's plan limits.
export const CLOUDFLARE_IMAGES_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const dimension = z.number().int().positive().max(32768);
const inputSchema = z
  .object({
    scope: z
      .object({ workspaceId: z.uuid(), projectId: z.uuid(), albumId: z.uuid() })
      .strict(),
    photoId: z.uuid(),
    versionId: z.uuid(),
    sourceBytes: z.instanceof(Uint8Array),
    expected: z
      .object({
        mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        bytes: z
          .number()
          .int()
          .positive()
          .max(CLOUDFLARE_IMAGES_MAX_SOURCE_BYTES),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        width: dimension,
        height: dimension,
      })
      .strict(),
  })
  .strict();

export class CloudflareImageProcessingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CloudflareImageProcessingError';
  }
}
function fail(code: string): never {
  throw new CloudflareImageProcessingError(code);
}
const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

async function boundedOutput(
  response: Response,
): Promise<Uint8Array<ArrayBuffer>> {
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg' ||
    !response.body
  ) {
    await response.body?.cancel();
    fail('output_invalid');
  }
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_OUTPUT_BYTES)
  ) {
    await response.body!.cancel();
    fail('output_too_large');
  }
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_OUTPUT_BYTES) {
        await reader.cancel();
        fail('output_too_large');
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (!size || (declared !== null && Number(declared) !== size))
    fail('output_invalid');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Strip JPEG metadata segments across baseline/progressive scans; preserve encoded pixels. */
function privateJpeg(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('output_invalid');
  const keep: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2,
    scan = false,
    sawScan = false;
  while (offset < bytes.length) {
    if (scan) {
      const start = offset;
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = bytes[offset + 1];
        if (
          marker === 0x00 ||
          (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)
        ) {
          offset += 2;
          continue;
        }
        break;
      }
      keep.push(bytes.subarray(start, offset));
      scan = false;
    }
    const start = offset;
    if (bytes[offset++] !== 0xff) fail('output_invalid');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!sawScan || offset !== bytes.length) fail('output_invalid');
      keep.push(bytes.subarray(start, offset));
      const result = new Uint8Array(
        keep.reduce((sum, part) => sum + part.length, 0),
      );
      let at = 0;
      for (const part of keep) {
        result.set(part, at);
        at += part.length;
      }
      return result;
    }
    if (
      marker === undefined ||
      marker === 0 ||
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7) ||
      offset + 2 > bytes.length
    )
      fail('output_invalid');
    const length = bytes[offset]! * 256 + bytes[offset + 1]!;
    if (length < 2 || offset + length > bytes.length) fail('output_invalid');
    offset += length;
    // APP0/JFIF and APP14/Adobe describe pixel interpretation, not personal metadata.
    const metadata =
      marker === 0xfe || (marker >= 0xe1 && marker <= 0xef && marker !== 0xee);
    if (!metadata) keep.push(bytes.subarray(start, offset));
    if (marker === 0xda) {
      scan = true;
      sawScan = true;
    }
  }
  return fail('output_invalid');
}

/** No network URLs, R2 writes, retries or quota mutations; the durable runner owns these. */
export class CloudflareImagesProcessor implements ImageProcessingAdapter {
  constructor(private readonly images: Pick<ImagesBinding, 'info' | 'input'>) {}
  async process(input: ImageProcessingInput): Promise<ImageProcessingResult> {
    const parsed = inputSchema.safeParse(input);
    if (
      !parsed.success ||
      input.sourceBytes.byteLength > CLOUDFLARE_IMAGES_MAX_SOURCE_BYTES
    )
      fail('invalid_input');
    // Snapshot caller-owned identity and bytes before the first await.
    const data = parsed.data!,
      bytes = new Uint8Array(data.sourceBytes),
      expected = data.expected;
    if (bytes.length !== expected.bytes) fail('source_size_mismatch');
    if (expected.width * expected.height > 80_000_000)
      fail('source_dimensions_out_of_range');
    if ((await hash(bytes)) !== expected.sha256) fail('source_hash_mismatch');
    try {
      const header = inspectImageHeader(
        bytes.subarray(0, MAX_IMAGE_HEADER_BYTES),
        expected.mime,
        bytes.length,
      );
      if (header.width !== expected.width || header.height !== expected.height)
        fail('source_dimensions_mismatch');
      if (isAnimatedOrMultiImage(bytes, expected.mime)) fail('animated_image');
      const sourceInfo = await this.images.info(stream(bytes));
      if (
        !('width' in sourceInfo) ||
        sourceInfo.format !== expected.mime ||
        sourceInfo.fileSize !== bytes.length ||
        !(
          (sourceInfo.width === expected.width &&
            sourceInfo.height === expected.height) ||
          (sourceInfo.width === expected.height &&
            sourceInfo.height === expected.width)
        )
      )
        fail('source_decode_mismatch');
      const artifacts: ProcessedImageArtifact[] = [];
      // Sequential transforms keep memory bounded and stop immediately on a failed provider call.
      for (const [kind, edge] of [
        ['thumbnail', 320],
        ['preview', 2048],
      ] as const) {
        const encoded = await this.images
          .input(stream(bytes))
          .transform({
            width: edge,
            height: edge,
            fit: 'scale-down',
            background: '#ffffff',
          })
          .output({ format: 'image/jpeg', quality: 82, anim: false });
        const output = privateJpeg(await boundedOutput(encoded.response()));
        const header = inspectImageHeader(
          output.subarray(0, MAX_IMAGE_HEADER_BYTES),
          'image/jpeg',
          output.length,
        );
        const info = await this.images.info(stream(output));
        if (
          !('width' in info) ||
          info.format !== 'image/jpeg' ||
          info.fileSize !== output.length ||
          info.width !== header.width ||
          info.height !== header.height ||
          info.width > edge ||
          info.height > edge ||
          Math.max(info.width, info.height) >
            Math.max(expected.width, expected.height) ||
          Math.min(info.width, info.height) >
            Math.min(expected.width, expected.height)
        )
          fail('output_verification_failed');
        artifacts.push({
          kind,
          bytes: output,
          mime: 'image/jpeg',
          width: info.width,
          height: info.height,
          sha256: await hash(output),
        });
      }
      return {
        processorVersion: CLOUDFLARE_IMAGES_PROCESSOR_VERSION,
        scope: data.scope,
        photoId: data.photoId,
        versionId: data.versionId,
        source: expected,
        artifacts,
      };
    } catch (error) {
      if (error instanceof CloudflareImageProcessingError) throw error;
      // Provider exceptions can carry request details. Keep them out of client/log surfaces.
      return fail('provider_or_image_rejected');
    }
  }
}
