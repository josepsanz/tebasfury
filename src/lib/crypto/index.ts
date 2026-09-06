import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  return Buffer.from(getEnv().CREDENTIALS_KEY, "base64");
}

/** Encrypts a secret for storage. The result is `iv.ciphertext.tag`, base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((b) => b.toString("base64url")).join(".");
}

/** Reverses `seal`. Throws if the value was tampered with or is not well formed. */
export function open(sealed: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 3) throw new Error("Malformed sealed value");
  const [iv, body, tag] = parts.map((p) => Buffer.from(p, "base64url"));
  const decipher = createDecipheriv(ALGORITHM, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
