const droppedPaths = new WeakMap<File, string>();

export function folderFileKey(file: File) {
  return JSON.stringify([
    droppedPaths.get(file) || file.webkitRelativePath || file.name,
    file.size,
    file.lastModified,
  ]);
}

export async function readDroppedFiles(
  transfer: DataTransfer,
): Promise<{ files: File[]; folder: boolean }> {
  const items = Array.from(transfer.items).filter(
    (item) => item.kind === 'file',
  );
  if (!items.length)
    return { files: Array.from(transfer.files), folder: false };
  // Capture roots before the browser releases the drop event's file handles.
  const roots = items.map(
    (item) => item.webkitGetAsEntry?.() ?? item.getAsFile(),
  );
  const files: File[] = [];
  async function visit(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) =>
        (entry as FileSystemFileEntry).file(ok, fail),
      );
      if (entry.fullPath)
        droppedPaths.set(file, entry.fullPath.replace(/^\//u, ''));
      files.push(file);
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
  return {
    files,
    folder: roots.some(
      (root) => root !== null && !(root instanceof File) && root.isDirectory,
    ),
  };
}
