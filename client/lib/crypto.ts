import nacl from "tweetnacl";
import { generateMnemonic, mnemonicToSeed } from "bip39";
import {
  CryptoKeyPair,
  EncryptedMessage,
  DecryptedMessage,
  MnemonicData,
} from "@shared/crypto";

// Utility functions for encoding/decoding
function utf8Encode(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

function utf8Decode(bytes: Uint8Array): string {
  const decoder = new TextDecoder();
  return decoder.decode(bytes);
}

/**
 * Generate a new cryptographic key pair
 * Returns both raw Uint8Array and base64-encoded versions
 */
export function generateKeyPair(): CryptoKeyPair {
  const keypair = nacl.box.keyPair();

  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.secretKey,
    publicKeyBase64: bytesToBase64(keypair.publicKey),
    privateKeyBase64: bytesToBase64(keypair.secretKey),
  };
}

/**
 * Derive a unique user ID from a public key
 * Uses SHA-256 hash of the public key
 */
export async function deriveUserIdFromPublicKey(
  publicKeyBase64: string,
): Promise<string> {
  const publicKeyBytes = base64ToBytes(publicKeyBase64);
  const hashBuffer = await crypto.subtle.digest("SHA-256", publicKeyBytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex.substring(0, 16); // Use first 16 chars for user ID
}

/**
 * Generate a mnemonic recovery phrase (BIP39)
 * Can be used to restore the account on other devices
 */
export function generateMnemonicPhrase(): MnemonicData {
  const mnemonic = generateMnemonic(256); // 24-word phrase
  const seed = mnemonicToSeed(mnemonic);

  return {
    mnemonic,
    seed: bytesToBase64(new Uint8Array(seed)),
  };
}

/**
 * Sign a challenge message with the private key
 * Used for authentication
 */
export function signChallenge(
  challenge: string,
  privateKeyBase64: string,
): string {
  const privateKeyBytes = base64ToBytes(privateKeyBase64);
  const challengeBytes = utf8Encode(challenge);
  const signature = nacl.sign.detached(challengeBytes, privateKeyBytes);
  return bytesToBase64(signature);
}

/**
 * Verify a signed challenge
 * Server-side verification of client signatures
 */
export function verifyChallenge(
  challenge: string,
  signature: string,
  publicKeyBase64: string,
): boolean {
  try {
    const publicKeyBytes = base64ToBytes(publicKeyBase64);
    const challengeBytes = utf8Encode(challenge);
    const signatureBytes = base64ToBytes(signature);
    return nacl.sign.detached.verify(
      challengeBytes,
      signatureBytes,
      publicKeyBytes,
    );
  } catch {
    return false;
  }
}

/**
 * Encrypt a message for a recipient
 * Uses recipient's public key for encryption
 * Returns encrypted message with nonce
 */
export function encryptMessage(
  message: string,
  recipientPublicKeyBase64: string,
  senderPrivateKeyBase64: string,
): EncryptedMessage {
  const recipientPublicKey = base64ToBytes(recipientPublicKeyBase64);
  const senderPrivateKey = base64ToBytes(senderPrivateKeyBase64);

  const messageBytes = utf8Encode(message);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const ciphertext = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderPrivateKey,
  );

  // Note: You'll need to add senderId and recipientId in the calling code
  return {
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(ciphertext),
    senderId: "",
    recipientId: "",
    timestamp: Date.now(),
  };
}

/**
 * Decrypt a message encrypted for you
 * Uses sender's public key and your private key
 */
export function decryptMessage(
  encrypted: EncryptedMessage,
  senderPublicKeyBase64: string,
  recipientPrivateKeyBase64: string,
): DecryptedMessage | null {
  try {
    const senderPublicKey = base64ToBytes(senderPublicKeyBase64);
    const recipientPrivateKey = base64ToBytes(recipientPrivateKeyBase64);
    const nonce = base64ToBytes(encrypted.nonce);
    const ciphertext = base64ToBytes(encrypted.ciphertext);

    const messageBytes = nacl.box.open(
      ciphertext,
      nonce,
      senderPublicKey,
      recipientPrivateKey,
    );

    if (!messageBytes) {
      console.error("Failed to decrypt message");
      return null;
    }

    const content = utf8Decode(messageBytes);

    return {
      senderId: encrypted.senderId,
      recipientId: encrypted.recipientId,
      content,
      timestamp: encrypted.timestamp,
    };
  } catch (error) {
    console.error("Decryption error:", error);
    return null;
  }
}

/**
 * Utility: Convert bytes to base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Utility: Convert base64 string to bytes
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Generate a random challenge string for authentication
 */
export function generateChallenge(length: number = 32): string {
  const randomBytes = nacl.randomBytes(length);
  return bytesToBase64(randomBytes);
}

/**
 * Store cryptographic key pair securely in localStorage
 * In production, consider using IndexedDB with encryption
 * or a secure storage mechanism
 */
export function storeKeyPair(keyPair: CryptoKeyPair): void {
  const stored = {
    publicKey: keyPair.publicKeyBase64,
    privateKey: keyPair.privateKeyBase64,
    createdAt: Date.now(),
  };
  localStorage.setItem("crypto_keypair", JSON.stringify(stored));
}

/**
 * Retrieve stored key pair from localStorage
 */
export function getStoredKeyPair(): CryptoKeyPair | null {
  const stored = localStorage.getItem("crypto_keypair");
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored);
    return {
      publicKey: base64ToBytes(parsed.publicKey),
      privateKey: base64ToBytes(parsed.privateKey),
      publicKeyBase64: parsed.publicKey,
      privateKeyBase64: parsed.privateKey,
    };
  } catch {
    return null;
  }
}

/**
 * Delete stored key pair from localStorage
 */
export function clearKeyPair(): void {
  localStorage.removeItem("crypto_keypair");
}

/**
 * Store mnemonic securely (WARNING: only for recovery)
 * Never store mnemonic with the key pair in real app
 */
export function storeMnemonic(mnemonic: string): void {
  // In production, use secure storage like encrypted IndexedDB
  localStorage.setItem("crypto_mnemonic", mnemonic);
}

/**
 * Retrieve stored mnemonic
 */
export function getStoredMnemonic(): string | null {
  return localStorage.getItem("crypto_mnemonic");
}

/**
 * Clear stored mnemonic
 */
export function clearMnemonic(): void {
  localStorage.removeItem("crypto_mnemonic");
}
