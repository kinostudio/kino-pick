import { startOAuth } from '@/lib/auth/oauth';
export async function POST(request: Request) {
  return startOAuth(request, 'google');
}
