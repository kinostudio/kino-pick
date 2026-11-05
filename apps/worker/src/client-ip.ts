import { z } from 'zod';

export function clientActivityIp(
  request: Request,
  local: boolean,
): string | null {
  // Workers subrequests can change visitor headers; accept direct edge traffic only.
  if (
    local ||
    !('cf' in request) ||
    !request.cf ||
    request.headers.has('CF-Worker')
  )
    return null;
  const value = request.headers.get('CF-Connecting-IP');
  return value && z.union([z.ipv4(), z.ipv6()]).safeParse(value).success
    ? value
    : null;
}
