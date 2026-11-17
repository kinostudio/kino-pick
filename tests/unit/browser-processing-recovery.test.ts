import { beforeEach, expect, it, vi } from 'vitest';
import type {
  ImageProcessingInput,
  ImageProcessingResult,
} from '../../packages/domain/src';
import type { ProcessingObjectStore } from '../../packages/image-processing/src/durable-runner';
const processor = vi.hoisted(() => ({ construct: vi.fn(), process: vi.fn() }));
vi.mock('../../packages/image-processing/src/browser-first', () => ({
  BrowserFirstImageProcessor: class {
    constructor(...args: unknown[]) {
      processor.construct(...args);
    }
    process(input: unknown) {
      return processor.process(input);
    }
  },
}));
import { browserFirstProcessor } from '../../apps/worker/src/browser-processing';
const scope = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  albumId: '33333333-3333-4333-8333-333333333333',
};
const input: ImageProcessingInput = {
  scope,
  photoId: '44444444-4444-4444-8444-444444444444',
  versionId: '55555555-5555-4555-8555-555555555555',
  sourceBytes: new Uint8Array([1]),
  expected: {
    mime: 'image/jpeg',
    bytes: 1,
    sha256: 'a'.repeat(64),
    width: 1,
    height: 1,
  },
};
function fixture() {
  const bind = vi.fn().mockReturnThis();
  const db = {
    prepare: vi.fn(() => ({
      bind,
      all: async () => ({
        success: true,
        results: [{ kind: 'thumbnail', object_key: 'immutable-thumbnail' }],
      }),
    })),
  } as unknown as D1Database;
  const read = vi.fn<ProcessingObjectStore['read']>();
  const objects: ProcessingObjectStore = { read, putIfAbsent: vi.fn() };
  return { db, bind, read, objects };
}
beforeEach(() => {
  processor.construct.mockReset();
  processor.process.mockReset().mockResolvedValue({} as ImageProcessingResult);
});

it('recovers only the exact claimed photo/version slots and preserves existing bytes for the adapter', async () => {
  const { db, bind, read, objects } = fixture();
  const existing = new Uint8Array([9, 8, 7]);
  read.mockResolvedValue(existing);
  await browserFirstProcessor(db, {} as ImagesBinding, 'job', objects).process(
    input,
  );
  expect(bind).toHaveBeenCalledWith(
    'job',
    scope.workspaceId,
    scope.projectId,
    scope.albumId,
    input.photoId,
    input.versionId,
  );
  expect(read).toHaveBeenCalledWith(scope, 'immutable-thumbnail', 8388608);
  expect(processor.construct.mock.calls[0]?.[2]).toEqual({
    thumbnail: existing,
  });
});

it('does not treat an uncertain storage read as permission to regenerate an existing immutable slot', async () => {
  const { db, read, objects } = fixture();
  read.mockRejectedValue(new Error('NETWORK_LOST'));
  await expect(
    browserFirstProcessor(db, {} as ImagesBinding, 'job', objects).process(
      input,
    ),
  ).rejects.toThrow('NETWORK_LOST');
  expect(processor.process).not.toHaveBeenCalled();
  read.mockRejectedValue(new Error('PROCESSING_OBJECT_MISSING'));
  await browserFirstProcessor(db, {} as ImagesBinding, 'job', objects).process(
    input,
  );
  expect(processor.construct.mock.calls[0]?.[2]).toBeUndefined();
});
