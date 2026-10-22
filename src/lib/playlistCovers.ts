const DATABASE_NAME = "media-thingy-playlist-covers";
const STORE_NAME = "covers";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
let databasePromise: Promise<IDBDatabase> | undefined;

function storageError(error: unknown, fallback: string): Error {
  const name =
    error && typeof error === "object" && "name" in error ? error.name : "";
  if (name === "QuotaExceededError") {
    return new Error(
      "Your browser storage is full. Remove a few songs or playlist covers, then try again.",
    );
  }
  if (name === "SecurityError" || name === "NotAllowedError") {
    return new Error(
      "Your browser blocked local storage. Allow site storage to save a playlist cover.",
    );
  }
  return new Error(fallback);
}

function openDatabase(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) {
    return Promise.reject(
      new Error(
        "Your browser cannot save playlist covers. Try a current browser with site storage enabled.",
      ),
    );
  }
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE_NAME);
      request.onerror = () =>
        reject(
          storageError(
            request.error,
            "Playlist covers could not be opened. Check that site storage is enabled.",
          ),
        );
      request.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "Close other Media-thingy tabs, then try loading your playlist covers again.",
          ),
        );
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        resolve(database);
      };
    }).catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function transactionComplete(
  transaction: IDBTransaction,
  fallback: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    // Wait for abort: transaction.error then preserves the actual quota failure.
    transaction.onabort = () =>
      reject(storageError(transaction.error, fallback));
  });
}

function requirePlaylistId(playlistId: string): void {
  if (!playlistId.trim())
    throw new Error("Choose a playlist before updating its cover.");
}

/** Covers use a separate database so saving an image never changes the music schema. */
export async function listPlaylistCoverBlobs(): Promise<Record<string, Blob>> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const complete = transactionComplete(
    transaction,
    "Saved playlist covers could not be loaded. Try refreshing the page.",
  );
  const store = transaction.objectStore(STORE_NAME);
  const keys = store.getAllKeys();
  const values = store.getAll();
  await complete;
  return Object.fromEntries(
    keys.result.flatMap((key, index) =>
      typeof key === "string" && values.result[index] instanceof Blob
        ? [[key, values.result[index]]]
        : [],
    ),
  );
}

export async function savePlaylistCoverBlob(
  playlistId: string,
  blob: Blob,
): Promise<void> {
  requirePlaylistId(playlistId);
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const complete = transactionComplete(
    transaction,
    "The playlist cover could not be saved. Try again with site storage enabled.",
  );
  transaction.objectStore(STORE_NAME).put(blob, playlistId);
  await complete;
}

export async function deletePlaylistCoverBlob(
  playlistId: string,
): Promise<void> {
  requirePlaylistId(playlistId);
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const complete = transactionComplete(
    transaction,
    "The playlist cover could not be removed. Please try again.",
  );
  transaction.objectStore(STORE_NAME).delete(playlistId);
  await complete;
}

function supportedSignature(bytes: Uint8Array): boolean {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.subarray(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return true;
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") return true;
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return true;
  if (ascii(4, 8) === "ftyp") {
    for (let offset = 8; offset + 4 <= bytes.length; offset += 4) {
      if (offset === 12) continue; // ftyp's minor version is not a compatible brand.
      if (
        ascii(offset, offset + 4) === "avif" ||
        ascii(offset, offset + 4) === "avis"
      )
        return true;
    }
  }
  return false;
}

function decodeImage(file: File, url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (success: boolean) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (success && image.naturalWidth > 0 && image.naturalHeight > 0)
        resolve(image);
      else
        reject(
          new Error(
            `“${file.name}” could not be opened as an image. Try another JPEG, PNG, WebP, GIF, or AVIF file.`,
          ),
        );
    };
    const timeout = setTimeout(() => finish(false), 15000);
    image.decoding = "async";
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob?.size) resolve(blob);
        else
          reject(
            new Error("This image could not be processed. Try another photo."),
          );
      },
      type,
      0.9,
    );
  });
}

/** Validate bytes, decode, and make a center-cropped cover without retaining the original. */
export async function preparePlaylistCover(file: File): Promise<Blob> {
  if (!file.size) throw new Error("This image is empty. Choose another photo.");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("Choose an image smaller than 10 MB.");
  const type = file.type.toLowerCase();
  if (
    (type && !IMAGE_TYPES.has(type)) ||
    (!type && !/\.(jpe?g|png|webp|gif|avif)$/i.test(file.name))
  ) {
    throw new Error(
      "Choose a JPEG, PNG, WebP, GIF, or AVIF image. SVG files are not supported.",
    );
  }
  if (
    !supportedSignature(new Uint8Array(await file.slice(0, 256).arrayBuffer()))
  ) {
    throw new Error("Choose a valid JPEG, PNG, WebP, GIF, or AVIF image.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await decodeImage(file, url);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const size = Math.min(640, side);
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "Your browser could not process this image. Try another browser or photo.",
      );
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const webp = await encodeCanvas(canvas, "image/webp");
    if (webp.type === "image/webp") return webp;
    // Browsers without WebP encoders fall back to PNG. Use JPEG explicitly instead.
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ece9e5";
    context.fillRect(0, 0, size, size);
    return await encodeCanvas(canvas, "image/jpeg");
  } finally {
    URL.revokeObjectURL(url);
  }
}
