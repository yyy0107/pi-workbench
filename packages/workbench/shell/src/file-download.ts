export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 40_000);
  }
}

export async function saveFileAs(filename: string, readBlob: () => Promise<Blob>): Promise<void> {
  const browserWindow =
    typeof window === "undefined"
      ? undefined
      : (window as Window & {
          showSaveFilePicker?: (options: {
            suggestedName: string;
          }) => Promise<FileSystemFileHandle>;
        });
  if (!browserWindow?.showSaveFilePicker) {
    downloadBlob(await readBlob(), filename);
    return;
  }

  // Request the picker before reading the file so the click's user activation is still available.
  const handle = await browserWindow.showSaveFilePicker({ suggestedName: filename });
  const blob = await readBlob();
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}
