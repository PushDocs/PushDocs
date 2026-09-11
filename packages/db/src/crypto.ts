import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function keyFromEnvironment(): Buffer {
  const encoded = process.env.PUSHDOCS_ENCRYPTION_KEY;
  if (!encoded) throw new Error("PUSHDOCS_ENCRYPTION_KEY is required");
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new Error("PUSHDOCS_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  }
  return key;
}

export function encryptSecret(value: string, context?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnvironment(), iv);
  if (context) cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(value: string, context?: string): string {
  const [ivEncoded, tagEncoded, encryptedEncoded] = value.split(".");
  if (!ivEncoded || !tagEncoded || !encryptedEncoded) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    keyFromEnvironment(),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  if (context) decipher.setAAD(Buffer.from(context));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
