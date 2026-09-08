export async function readJsonBody(request: Request, limit = 8_000_000): Promise<unknown> {
  if (!request.body || Number(request.headers.get("content-length")) > limit)
    throw new Error("Запрос слишком большой или пустой");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Запрос слишком большой");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
