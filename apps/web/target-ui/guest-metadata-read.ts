const guestMetadataPath =
  /^\/api\/guest\/(?:feedback\/capabilities|deliveries\/capabilities|albums\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:access|downloads|deliveries|ratings|favorites))(?:\?[^#]*)?$(?![\s\S])/i;

const retryableStatuses = new Set([502, 503, 504]);

function guestMetadataFamily(path: string) {
  if (path.startsWith('/api/guest/feedback/capabilities'))
    return 'feedback-capabilities';
  if (path.startsWith('/api/guest/deliveries/capabilities'))
    return 'delivery-capabilities';
  const pathname = path.split('?', 1)[0] ?? '';
  const resource = pathname.slice(pathname.lastIndexOf('/') + 1).toLowerCase();
  switch (resource) {
    case 'access':
    case 'downloads':
    case 'deliveries':
    case 'ratings':
    case 'favorites':
      return `album-${resource}`;
    default:
      return 'other';
  }
}

function warnGuestMetadataFailure(
  family: string,
  failure: { status: number } | { network: true },
) {
  console.warn(
    'Guest metadata read failed ' + JSON.stringify({ family, ...failure }),
  );
}

async function readGuestMetadata(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const requestInit: RequestInit = { ...init, cache: 'no-store' };
  let response: Response;

  try {
    response = await fetch(path, requestInit);
  } catch (error) {
    if (!(error instanceof TypeError) || init?.signal?.aborted) throw error;
    return fetch(path, requestInit);
  }

  if (!retryableStatuses.has(response.status)) return response;

  try {
    await response.body?.cancel();
  } catch {
    // Retry the read even if the failed response stream could not be canceled.
  }

  return init?.signal?.aborted ? response : fetch(path, requestInit);
}

export async function fetchGuestMetadataRead(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const method = init?.method;
  if (
    (method !== undefined && method.toUpperCase() !== 'GET') ||
    !guestMetadataPath.test(path)
  )
    return fetch(path, init);

  try {
    const response = await readGuestMetadata(path, init);
    if (!response.ok && !init?.signal?.aborted)
      warnGuestMetadataFailure(guestMetadataFamily(path), {
        status: response.status,
      });
    return response;
  } catch (error) {
    if (error instanceof TypeError && !init?.signal?.aborted)
      warnGuestMetadataFailure(guestMetadataFamily(path), { network: true });
    throw error;
  }
}
