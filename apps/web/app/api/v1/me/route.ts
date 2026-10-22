import { authenticatedContext } from '@/lib/auth/server';
import { apiFailure, json } from '@/lib/http';
export async function GET() {
  try {
    const { actor } = await authenticatedContext(true);
    return json({ actor });
  } catch (error) {
    return apiFailure(error);
  }
}
