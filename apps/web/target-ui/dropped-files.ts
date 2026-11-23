export async function readDroppedFiles(
  transfer: DataTransfer,
): Promise<File[]> {
  const items = Array.from(transfer.items).filter(
    (item) => item.kind === 'file',
  );
  if (!items.length) return Array.from(transfer.files);
  // Capture roots before the browser releases the drop event's file handles.
  const roots = items.map(
    (item) => item.webkitGetAsEntry?.() ?? item.getAsFile(),
  );
  const files: File[] = [];
  async function visit(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      files.push(
        await new Promise<File>((ok, fail) =>
          (entry as FileSystemFileEntry).file(ok, fail),
        ),
      );
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) =>
          reader.readEntries(ok, fail),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child);
      }
    }
  }
  for (const root of roots) {
    if (root instanceof File) files.push(root);
    else if (root) await visit(root);
  }
  return files;
}
