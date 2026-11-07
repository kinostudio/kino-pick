const guestMetadataPath =
  /^\/api\/guest\/(?:feedback\/capabilities|deliveries\/capabilities|albums\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:access|downloads|deliveries|ratings|favorites))(?:\?[^#]*)?$(?![\s\S])/i;

const retryableStatuses = new Set([502, 503, 504]);

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
