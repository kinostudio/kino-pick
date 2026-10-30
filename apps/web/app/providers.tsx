'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { installPhotoInteractionGuard } from '../photo-interaction-guard';
export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => installPhotoInteractionGuard(document), []);
  const [client] = useState(() => new QueryClient());
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
