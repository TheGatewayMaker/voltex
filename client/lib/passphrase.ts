import { CryptoKeyPair } from "@shared/crypto";
import nacl from "tweetnacl";

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

    const privateKeyBytes = base64ToBytes(parsed.privateKeyBase64);

    // Check if this is an old keypair format (only has signing keys)
    // Old keypairs had 64-byte private keys (Ed25519), new ones have 32-byte (Curve25519)
    if (privateKeyBytes.length === 64) {
      // This is an old signing-only keypair format
      // Keep the original signing keys as-is since they're what was stored on the server
      // For encryption operations, derive box keys from the signing key seed
      const signPrivateKeyBytes = privateKeyBytes;
      const signPublicKeyBytes = base64ToBytes(parsed.publicKeyBase64);

      // Derive box keypair from the first 32 bytes of the signing key (the seed)
      const boxKeypair = nacl.box.keyPair.fromSecretKey(
        signPrivateKeyBytes.slice(0, 32),
      );

      console.log(
        "Loaded old keypair format (signing-only) - derived box keys for encryption",
      );

      return {
        publicKey: base64ToBytes(parsed.publicKeyBase64), // Keep original signing public key
        privateKey: signPrivateKeyBytes, // Keep original signing private key
        publicKeyBase64: parsed.publicKeyBase64, // For user ID derivation
        privateKeyBase64: parsed.privateKeyBase64, // This is actually the signing key
        // But also provide box keys for encryption
        signPublicKeyBase64: bytesToBase64(signPublicKeyBytes),
        signPrivateKeyBase64: bytesToBase64(signPrivateKeyBytes),
      };
    }

    // New format: we have separate box and sign keys
    let signPublicKeyBase64 = parsed.signPublicKeyBase64;
    let signPrivateKeyBase64 = parsed.signPrivateKeyBase64;

    if (!signPublicKeyBase64 || !signPrivateKeyBase64) {
      // New format but missing signing keys - derive them
      const encryptionKeyBytes = base64ToBytes(parsed.privateKeyBase64);
      const signKeypair = nacl.sign.keyPair.fromSeed(
        encryptionKeyBytes.slice(0, 32),
      );
      signPublicKeyBase64 = bytesToBase64(signKeypair.publicKey);
      signPrivateKeyBase64 = bytesToBase64(signKeypair.secretKey);

      console.log("Derived missing signing keys from box private key");
    }

    return {
      publicKey: base64ToBytes(parsed.publicKeyBase64),
      privateKey: base64ToBytes(parsed.privateKeyBase64),
      publicKeyBase64: parsed.publicKeyBase64,
      privateKeyBase64: parsed.privateKeyBase64,
      signPublicKeyBase64,
      signPrivateKeyBase64,
    };
  } catch (error) {
    console.error("Failed to decrypt keypair:", error);
    return null;
  }
}
