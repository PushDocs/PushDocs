// TOTP conventions and replay counter follow appnotes/packages/core/src/totp.ts.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  let bits = 0;
  let value = 0;
  let result = "";
  for (const byte of randomBytes(20)) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return result;
}

export function totpCode(secret: string, time: number): string {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of secret) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (bytes.length < 20) throw new Error("TOTP secret is too short");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest.readUInt8(digest.length - 1) & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

export function verifyTotp(secret: string, code: string, time = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(time / 30_000);
  for (const offset of [0, -1, 1]) {
    const counter = current + offset;
    if (
      counter >= 0 &&
      timingSafeEqual(Buffer.from(totpCode(secret, counter * 30_000)), Buffer.from(code))
    )
      return counter;
  }
  return null;
}

export function createTotpUri(email: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(`PushDocs:${email}`)}?${new URLSearchParams({ secret, issuer: "PushDocs", algorithm: "SHA1", digits: "6", period: "30" })}`;
}
