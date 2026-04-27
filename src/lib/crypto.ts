/**
 * AES-256-GCM 暗号化ヘルパ。
 *
 * Spotify アクセストークン / リフレッシュトークンを DB に保存する際、
 * このモジュールで暗号化してから格納する(漏洩リスクを軽減)。
 *
 * 鍵: 環境変数 TOKEN_ENCRYPTION_KEY (32 バイト = 64 文字 hex)
 *   生成: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * 出力フォーマット: "iv:authTag:ciphertext" (各 base64)
 *   - iv: 12 バイト (GCM 推奨長)
 *   - authTag: 16 バイト (改ざん検知)
 *   - ciphertext: 任意長
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY is not set. Generate with: " +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (hex.length !== 64) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars), got ${hex.length} chars.`,
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const [ivB64, authTagB64, encryptedB64] = ciphertext.split(":");
  if (!ivB64 || !authTagB64 || !encryptedB64) {
    throw new Error("Invalid ciphertext format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const encrypted = Buffer.from(encryptedB64, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString(
    "utf8",
  );
}
