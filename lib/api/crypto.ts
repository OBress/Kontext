import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

function deriveKey(passphrase: string): Buffer {
  // Simple PBKDF2 derivation from the service role key
  return crypto.pbkdf2Sync(passphrase, "kontext-salt", 100000, 32, "sha256");
}

function getEncryptionKey(): Buffer {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for token encryption");
  }
  return deriveKey(serviceRoleKey);
}

export function encryptToken(plaintext: string): {
  ciphertext: string;
  iv: string;
  tag: string;
} {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

export function decryptToken(encrypted: {
  ciphertext: string;
  iv: string;
  tag: string;
}): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encrypted.iv, "base64");
  const tag = Buffer.from(encrypted.tag, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(encrypted.ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const rawBytes = crypto.randomBytes(32);
  const raw = `kt_${rawBytes.toString("base64url")}`;
  const prefix = raw.slice(0, 11); // "kt_" + 8 chars
  const hash = hashApiKey(raw);
  return { raw, prefix, hash };
}
