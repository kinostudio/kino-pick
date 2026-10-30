import { open } from 'node:fs/promises';
import { z } from 'zod';
import { localImageProcessingMetadataSchema } from '../../contracts/src/image-processing.ts';
import { LocalSharpImageProcessor } from './local-sharp.ts';
import { writeLocalImageProcessingResult } from './local-output.ts';

async function readBoundedFile(filename, limit) {
  const file = await open(filename, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > limit)
      throw new Error('LOCAL_INPUT_LIMIT');
    // Read at most limit+1 even if the file grows after stat.
    const chunks = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(65536, limit + 1 - total));
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      chunks.push(chunk.subarray(0, bytesRead));
      total += bytesRead;
      if (total > limit) throw new Error('LOCAL_INPUT_LIMIT');
    }
    return Buffer.concat(chunks, total);
  } finally {
    await file.close();
  }
}

const [metadataFile, sourceFile, outputRoot, jobId, ...extra] =
  process.argv.slice(2);
try {
  if (!metadataFile || !sourceFile || !outputRoot || !jobId || extra.length)
    throw new Error('USAGE');
  z.uuid().parse(jobId);
  const metadata = localImageProcessingMetadataSchema.parse(
    JSON.parse((await readBoundedFile(metadataFile, 16384)).toString('utf8')),
  );
  const sourceBytes = await readBoundedFile(
    sourceFile,
    metadata.expected.bytes,
  );
  const processor = new LocalSharpImageProcessor();
  const result = await processor.process({ ...metadata, sourceBytes });
  const { manifest } = await writeLocalImageProcessingResult({
    outputRoot,
    jobId,
    result,
  });
  // Never log local paths, source metadata, image contents or decoder exception text.
  console.log(
    JSON.stringify({
      status: 'processed_locally',
      jobId: manifest.jobId,
      artifacts: manifest.artifacts.map(({ kind, bytes, width, height }) => ({
        kind,
        bytes,
        width,
        height,
      })),
      publishedToR2: false,
    }),
  );
} catch (error) {
  if (error instanceof Error && error.message === 'USAGE') {
    console.error(
      'Usage: pnpm image:process:local <metadata.json> <source-file> <output-root> <job-uuid>',
    );
  } else {
    console.error('LOCAL_IMAGE_PROCESSING_FAILED');
  }
  process.exitCode = 1;
}
