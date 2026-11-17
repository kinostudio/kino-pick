export function photoDisplayName(filename: string) {
  const dot = filename.lastIndexOf('.');
  return dot > 0 && dot < filename.length - 1
    ? filename.slice(0, dot)
    : filename;
}
