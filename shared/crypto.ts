/**
 * Shared cryptographic types between client and server
 */

export interface KeyPair {
  publicKey: string; // base64-encoded
  privateKey: string; // base64-encoded (should only exist on client)
}

export interface CryptoKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  publicKeyBase64: string;
  privateKeyBase64: string;
}

export interface UserAccount {
  userId: string; // Derived from public key hash
  publicKey: string; // base64-encoded
  username?: string; // Optional username for user lookup
  createdAt: number;
}

export interface AuthChallenge {
  userId: string;
  challenge: string; // base64-encoded random bytes
  timestamp: number;
  expiresAt: number;
}

export interface AuthResponse {
  userId: string;
  signature: string; // base64-encoded signed challenge
  publicKey: string; // base64-encoded
}

export interface EncryptedMessage {
  nonce: string; // base64-encoded
  ciphertext: string; // base64-encoded
  signature: string; // base64-encoded NaCl signature for authenticity
  senderId: string;
  recipientId: string;
  timestamp: number;
}

export interface DecryptedMessage {
  senderId: string;
  recipientId: string;
  content: string;
  timestamp: number;
}

export interface SessionData {
  userId: string;
  publicKey: string;
  sessionToken: string;
  expiresAt: number;
}

export interface MnemonicData {
  mnemonic: string;
  seed: string;
}
