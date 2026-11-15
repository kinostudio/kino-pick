import { useEffect, useState } from 'react';
import { z } from 'zod';

const countsSchema = z.object({
  counts: z.array(
    z
      .object({ id: z.string().min(1) })
      .catchall(z.number().int().nonnegative()),
  ),
});

// Cards on one page share a single request per URL (brief cache).
const inflight = new Map<string, { at: number; body: Promise<unknown> }>();
function load(url: string) {
  const cached = inflight.get(url);
  if (cached && Date.now() - cached.at < 5000) return cached.body;
  const body = fetch(url, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  }).then((response) => (response.ok ? response.json() : null));
  inflight.set(url, { at: Date.now(), body });
  return body;
}

/**
 * Card counts (albums per project, photos per album) from a small Owner
 * endpoint. Returns null until loaded; failures simply hide the counts.
 */
export function useContentCounts(url: string, field: 'albums' | 'photos') {
  const [counts, setCounts] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void load(url)
      .then((body) => {
        const parsed = countsSchema.safeParse(body);
        if (!parsed.success || !alive) return;
        setCounts(
          new Map(
            parsed.data.counts.map((row) => [row.id, Number(row[field] ?? 0)]),
          ),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [url, field]);
  return counts;
}
