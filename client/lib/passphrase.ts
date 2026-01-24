import { CryptoKeyPair } from "@shared/crypto";

/**
 * Hash a passphrase using SHA-256
 * Used for recovery/account restoration
 */
export async function hashPassphrase(passphrase: string): Promise<string> {
  const encoded = new TextEncoder().encode(passphrase);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Normalize passphrase (trim and lowercase)
 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Validate passphrase format (should be 24 words)
 */
export function validatePassphraseFormat(passphrase: string): boolean {
  const words = normalizePassphrase(passphrase)
    .split(" ")
    .filter((w) => w.length > 0);
  return words.length === 24;
}

/**
 * Utility: Convert bytes to base64
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Utility: Convert base64 to bytes
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a random salt for key derivation
 */
export function generateSalt(): string {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64(saltBytes);
}

/**
 * Derive an encryption key from passphrase using PBKDF2
 * Uses 100,000 iterations for security
 */
export async function deriveEncryptionKey(
  passphrase: string,
  salt: string,
): Promise<CryptoKey> {
  const normalizedPassphrase = normalizePassphrase(passphrase);
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedPassphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const saltBytes = base64ToBytes(salt);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: 100000,
      hash: "SHA-256",
    },
    passphraseKey,
    256, // 256 bits for AES-256
  );

  return crypto.subtle.importKey("raw", derivedBits, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt a keypair using AES-GCM
 * Returns encrypted data and IV (both as base64)
 */
export async function encryptKeypair(
  keypair: CryptoKeyPair,
  encryptionKey: CryptoKey,
): Promise<{ encryptedData: string; iv: string }> {
  const keypairJson = JSON.stringify({
    publicKeyBase64: keypair.publicKeyBase64,
    privateKeyBase64: keypair.privateKeyBase64,
    signPublicKeyBase64: keypair.signPublicKeyBase64,
    signPrivateKeyBase64: keypair.signPrivateKeyBase64,
  });

  const encoder = new TextEncoder();
  const data = encoder.encode(keypairJson);
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for AES-GCM

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    data,
  );

  return {
    encryptedData: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

/**
 * Decrypt a keypair encrypted with AES-GCM
 */
export async function decryptKeypair(
  encryptedData: string,
  iv: string,
  encryptionKey: CryptoKey,
): Promise<CryptoKeyPair | null> {
  try {
    const encryptedBytes = base64ToBytes(encryptedData);
    const ivBytes = base64ToBytes(iv);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBytes },
      encryptionKey,
      encryptedBytes,
    );

    const decoder = new TextDecoder();
    const keypairJson = decoder.decode(decrypted);
    const parsed = JSON.parse(keypairJson);

    return {
      publicKey: base64ToBytes(parsed.publicKeyBase64),
      privateKey: base64ToBytes(parsed.privateKeyBase64),
      publicKeyBase64: parsed.publicKeyBase64,
      privateKeyBase64: parsed.privateKeyBase64,
    };
  } catch (error) {
    console.error("Failed to decrypt keypair:", error);
    return null;
  }
}
