/** Display reference only; UUIDs remain authoritative in routes and authorization. */
export function displayReference(id: string, prefix: 'INV' | 'PRJ') {
  return prefix + '-' + id.replaceAll('-', '').slice(0, 8).toUpperCase();
}
