import type { BrowserFile } from "@workbench/browser-contracts";

interface SaveFileHandle {
  createWritable(): Promise<{
    write(data: Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

/** Save a browser-produced file on the client, including when Chrome runs on another machine. */
export async function saveBrowserFile(file: BrowserFile, askLocation = false): Promise<void> {
  const name = file.name.split(/[\\/]/).pop() || "download";
  const blob = new Blob(
    [Uint8Array.from(atob(file.data), (character) => character.charCodeAt(0))],
    {
      type: file.mimeType,
    },
  );
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: { suggestedName: string }) => Promise<SaveFileHandle>;
    }
  ).showSaveFilePicker;
  if (askLocation && picker) {
    let handle: SaveFileHandle | undefined;
    try {
      handle = await picker.call(window, { suggestedName: name });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      // A remote response can outlive transient activation; the browser's normal download still works.
      if (!(error instanceof Error && error.name === "SecurityError")) throw error;
    }
    if (handle) {
      const writable = await handle.createWritable();
      try {
        await writable.write(blob);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => {});
        throw error;
      }
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.dataset.browserExternal = "";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Keep the object URL alive until the browser has consumed the download navigation.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export async function uploadBrowserFiles(files: readonly File[]): Promise<BrowserFile[]> {
  if (files.length > 20 || files.reduce((total, file) => total + file.size, 0) > 8 * 1024 * 1024) {
    throw new Error("browser-file-too-large");
  }
  return Promise.all(
    files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const chunks: string[] = [];
      for (let offset = 0; offset < bytes.length; offset += 32_768) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)));
      }
      return { name: file.name, mimeType: file.type, data: btoa(chunks.join("")) };
    }),
  );
}
