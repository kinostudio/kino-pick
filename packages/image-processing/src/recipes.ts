/** Immutable recipe identifiers. Changing parameters requires a new identifier. */
export const PROCESSING_RECIPES = [
  'local-sharp-0.35.5-v1',
  'cloudflare-images-jpeg-82-v1',
] as const;
export type ProcessingRecipe = (typeof PROCESSING_RECIPES)[number];
export function isProcessingRecipe(value: unknown): value is ProcessingRecipe {
  return PROCESSING_RECIPES.some((recipe) => recipe === value);
}
export function processingSourceLimit(recipe: string): number {
  if (!isProcessingRecipe(recipe))
    throw new Error('PROCESSING_RECIPE_UNSUPPORTED');
  return recipe === 'cloudflare-images-jpeg-82-v1'
    ? 16 * 1024 * 1024
    : 64 * 1024 * 1024;
}
