/** Operator-only synthetic capability probe, not a product processing API. */
type ProbeEnv = {
  IMAGES: ImagesBinding;
  PRIMARY_STORAGE: R2Bucket;
  PROBE_SOURCE_KEY: string;
  PROBE_PREFIX: string;
  PROBE_NONCE: string;
};
const hash = async (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
const stream = (bytes: ArrayBuffer) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
const probe = {
  async fetch(request: Request, env: ProbeEnv) {
    if (
      request.method !== 'POST' ||
      new URL(request.url).pathname !== '/probe' ||
      request.headers.get('X-Kino-Probe-Nonce') !== env.PROBE_NONCE
    )
      return new Response('Unavailable', { status: 404 });
    try {
      const source = await env.PRIMARY_STORAGE.get(env.PROBE_SOURCE_KEY);
      if (!source || source.size > 4096)
        return new Response('Synthetic source required', { status: 400 });
      const bytes = await source.arrayBuffer();
      const info = await env.IMAGES.info(stream(bytes));
      if (
        !('width' in info) ||
        info.format !== 'image/png' ||
        info.width !== 2 ||
        info.height !== 2
      )
        return new Response('Synthetic 2x2 PNG required', { status: 400 });
      const outputs = [];
      for (const [kind, edge] of [
        ['thumbnail', 320],
        ['preview', 2048],
      ] as const) {
        const transformed = await env.IMAGES.input(stream(bytes))
          .transform({ width: edge, height: edge, fit: 'scale-down' })
          .output({ format: 'image/jpeg', quality: 82, anim: false });
        const image = await transformed.response().arrayBuffer();
        if (image.byteLength > 65536) throw new Error('PROBE_OUTPUT_LIMIT');
        const resultInfo = await env.IMAGES.info(stream(image));
        if (
          !('width' in resultInfo) ||
          resultInfo.format !== 'image/jpeg' ||
          resultInfo.width !== 2 ||
          resultInfo.height !== 2
        )
          throw new Error('PROBE_OUTPUT_INVALID');
        const key = env.PROBE_PREFIX + '/' + kind + '.jpg';
        const created = await env.PRIMARY_STORAGE.put(key, image, {
          onlyIf: { etagDoesNotMatch: '*' },
          httpMetadata: { contentType: 'image/jpeg' },
          sha256: await crypto.subtle.digest('SHA-256', image),
        });
        if (!created) throw new Error('PROBE_IMMUTABLE_COLLISION');
        const readback = await env.PRIMARY_STORAGE.get(key);
        if (!readback) throw new Error('PROBE_READBACK');
        const digest = await hash(image);
        if ((await hash(await readback.arrayBuffer())) !== digest)
          throw new Error('PROBE_HASH');
        outputs.push({
          kind,
          key,
          bytes: image.byteLength,
          width: resultInfo.width,
          height: resultInfo.height,
          sha256: digest,
        });
      }
      return Response.json(
        {
          status: 'cloudflare_images_binding_passed',
          syntheticOnly: true,
          source: {
            format: info.format,
            width: info.width,
            height: info.height,
          },
          outputs,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'number'
          ? error.code
          : null;
      return Response.json(
        { status: 'probe_failed', providerCode: code },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }
  },
};
export default probe;
