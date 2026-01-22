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
