import { createHash } from "node:crypto";
import { open, unlink } from "node:fs/promises";

export async function storeUpload(
  body: ReadableStream<Uint8Array>,
  destination: string,
  maxBytes: number,
) {
  const file = await open(destination, "wx", 0o600);
  const reader = body.getReader();
  const hash = createHash("sha256");
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error("Файл превышает лимит загрузки");
      hash.update(value);
      let offset = 0;
      while (offset < value.byteLength) offset += (await file.write(value, offset)).bytesWritten;
    }
    if (!size) throw new Error("Пустой файл");
    await file.close();
    return { size, sha256: hash.digest("hex") };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    await file.close();
    await unlink(destination).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
