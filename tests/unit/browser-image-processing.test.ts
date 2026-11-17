import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BrowserImageProcessingError,
  generateBrowserDerivatives,
} from '../../apps/web/target-ui/browser-image-processing.ts';

type CanvasRecord = {
  width: number;
  height: number;
  released: boolean;
  createdAfterRelease: boolean;
  fill: string | null;
  drawWidth: number | null;
  drawHeight: number | null;
  quality: number | null;
};

let canvasRecords: CanvasRecord[] = [];
let bitmapRecords: Array<{ width: number; height: number; closed: boolean }> =
  [];
let decodeSize = { width: 1, height: 1 };
let encodedSizeOverride: number | null = null;

class MockOffscreenCanvas {
  private currentWidth = 0;
  private currentHeight = 0;
  private readonly record: CanvasRecord;
  private readonly context: {
    fillStyle: string;
    fillRect: () => void;
    drawImage: (
      image: ImageBitmap,
      x: number,
      y: number,
      width: number,
      height: number,
    ) => void;
  };

  constructor(width: number, height: number) {
    const previous = canvasRecords.at(-1);
    this.record = {
      width,
      height,
      released: false,
      createdAfterRelease: previous === undefined || previous.released,
      fill: null,
      drawWidth: null,
      drawHeight: null,
      quality: null,
    };
    canvasRecords.push(this.record);
    this.width = width;
    this.height = height;
    this.context = {
      fillStyle: '',
      fillRect: () => {
        this.record.fill = this.context.fillStyle;
      },
      drawImage: (_image, _x, _y, drawWidth, drawHeight) => {
        this.record.drawWidth = drawWidth;
        this.record.drawHeight = drawHeight;
      },
    };
  }

  get width() {
    return this.currentWidth;
  }

  set width(value: number) {
    this.currentWidth = value;
    if (value === 0) this.record.released = true;
  }

  get height() {
    return this.currentHeight;
  }

  set height(value: number) {
    this.currentHeight = value;
    if (value === 0) this.record.released = true;
  }

  getContext() {
    return this.context;
  }

  async convertToBlob(options: { quality?: number }) {
    this.record.quality = options.quality ?? null;
    const output = new Blob(['jpeg'], { type: 'image/jpeg' });
    if (encodedSizeOverride !== null)
      Object.defineProperty(output, 'size', { value: encodedSizeOverride });
    return output;
  }
}

function pngHeader(width: number, height: number) {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13, false);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  bytes[24] = 8;
  bytes[25] = 6;
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(29, (crc ^ 0xffffffff) >>> 0, false);
  return bytes;
}

function webpAnimationHeader() {
  const bytes = new Uint8Array(30);
  bytes.set([82, 73, 70, 70], 0);
  new DataView(bytes.buffer).setUint32(4, 22, true);
  bytes.set([87, 69, 66, 80, 86, 80, 56, 88], 8);
  new DataView(bytes.buffer).setUint32(16, 10, true);
  bytes[20] = 2;
  return bytes;
}

function installBrowserMocks() {
  canvasRecords = [];
  bitmapRecords = [];
  decodeSize = { width: 1, height: 1 };
  encodedSizeOverride = null;
  vi.stubGlobal('OffscreenCanvas', MockOffscreenCanvas);
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (_file: Blob, options: ImageBitmapOptions) => {
      expect(options.imageOrientation).toBe('from-image');
      const bitmap = { ...decodeSize, closed: false };
      bitmapRecords.push(bitmap);
      return {
        width: bitmap.width,
        height: bitmap.height,
        close: () => {
          bitmap.closed = true;
        },
      } as ImageBitmap;
    }),
  );
}

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('browser image derivative generation', () => {
  it('scales sequentially, paints transparency white, and leaves the source unchanged', async () => {
    installBrowserMocks();
    decodeSize = { width: 4000, height: 2000 };
    const source = new Blob([pngHeader(4000, 2000)], { type: 'image/png' });
    const originalHash = sha256(new Uint8Array(await source.arrayBuffer()));

    const derivatives = await generateBrowserDerivatives(source);

    expect(canvasRecords.map(({ width, height }) => [width, height])).toEqual([
      [320, 160],
      [2048, 1024],
    ]);
    expect(canvasRecords.map(({ fill }) => fill)).toEqual([
      '#ffffff',
      '#ffffff',
    ]);
    expect(canvasRecords.map(({ quality }) => quality)).toEqual([0.82, 0.82]);
    expect(
      canvasRecords.every(({ createdAfterRelease }) => createdAfterRelease),
    ).toBe(true);
    expect(canvasRecords.every(({ released }) => released)).toBe(true);
    expect(
      canvasRecords.map(({ drawWidth, drawHeight }) => [drawWidth, drawHeight]),
    ).toEqual([
      [320, 160],
      [2048, 1024],
    ]);
    expect(derivatives.thumbnail.type).toBe('image/jpeg');
    expect(derivatives.preview.type).toBe('image/jpeg');
    expect(bitmapRecords[0]?.closed).toBe(true);
    expect(sha256(new Uint8Array(await source.arrayBuffer()))).toBe(
      originalHash,
    );
  });

  it('does not enlarge small images and rejects invalid size, dimensions, formats, and animation', async () => {
    installBrowserMocks();
    const small = new Blob([pngHeader(80, 40)], { type: 'image/png' });
    decodeSize = { width: 80, height: 40 };
    await generateBrowserDerivatives(small);
    expect(canvasRecords.map(({ width, height }) => [width, height])).toEqual([
      [80, 40],
      [80, 40],
    ]);

    const large = new Blob(['x'], { type: 'image/png' });
    Object.defineProperty(large, 'size', { value: 64 * 1024 * 1024 + 1 });
    await expect(generateBrowserDerivatives(large)).rejects.toMatchObject({
      code: 'source_too_large',
    });
    await expect(
      generateBrowserDerivatives(
        new Blob([pngHeader(32769, 1)], { type: 'image/png' }),
      ),
    ).rejects.toMatchObject({ code: 'dimensions_exceeded' });
    await expect(
      generateBrowserDerivatives(
        new Blob([pngHeader(1, 1)], { type: 'image/gif' }),
      ),
    ).rejects.toMatchObject({ code: 'unsupported_format' });
    await expect(
      generateBrowserDerivatives(
        new Blob([webpAnimationHeader()], { type: 'image/webp' }),
      ),
    ).rejects.toMatchObject({ code: 'animated_image' });
    expect(vi.mocked(createImageBitmap)).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized derivatives and closes the decoded bitmap', async () => {
    installBrowserMocks();
    encodedSizeOverride = 8 * 1024 * 1024 + 1;
    const source = new Blob([pngHeader(1, 1)], { type: 'image/png' });

    const failure = await generateBrowserDerivatives(source).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(BrowserImageProcessingError);
    expect(failure).toMatchObject({ code: 'output_too_large' });
    expect(bitmapRecords.every(({ closed }) => closed)).toBe(true);
    expect(canvasRecords.every(({ released }) => released)).toBe(true);
  });
});
