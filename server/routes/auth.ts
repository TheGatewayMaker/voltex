import { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import {
  verifySignedChallenge,
  deriveUserIdFromPublicKey,
  generateChallenge,
  isChallengeExpired,
  isValidPublicKey,
  isValidSignature,
} from "../lib/crypto";
import {
  saveUserAccount,
  getUserAccount,
  savePassphraseRecovery,
  getPassphraseRecovery,
  checkUsernameAvailability,
  reserveUsername,
  getUserIdByUsername,
  saveEncryptedKeypair,
  getEncryptedKeypair,
  saveSession,
  getSessionData,
  deleteSessionData,
} from "../lib/r2-storage";
import {
  UserAccount,
  AuthChallenge,
  AuthResponse,
  SessionData,
} from "@shared/crypto";

// In-memory storage for challenges and sessions (temporary during request)
const challenges = new Map<string, AuthChallenge>();
const sessions = new Map<string, SessionData>();

/**
 * POST /api/auth/username-availability
 * Check if a username is available
 */
export const handleCheckUsernameAvailability: RequestHandler = async (
  req,
  res,
) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username is required" });
    }

    // Validate username format
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({
        error: "Username must be between 3 and 30 characters",
      });
    }

    // Check if username contains only alphanumeric and underscores
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({
        error: "Username can only contain letters, numbers, and underscores",
      });
    }

    const isAvailable = await checkUsernameAvailability(username);

    return res.status(200).json({
      available: isAvailable,
      username: username.toLowerCase(),
    });
  } catch (error) {
    console.error("Username availability check error:", error);
    return res
      .status(500)
      .json({ error: "Failed to check username availability" });
  }
};

/**
 * POST /api/auth/register
 * Create a new account with public key and store in R2
 */
export const handleRegister: RequestHandler = async (req, res) => {
  try {
    const { publicKey, passphraseHash, username } = req.body;

    if (!publicKey || typeof publicKey !== "string") {
      return res.status(400).json({ error: "Public key is required" });
    }

    if (!passphraseHash || typeof passphraseHash !== "string") {
      return res.status(400).json({ error: "Passphrase hash is required" });
    }

    if (username) {
      if (typeof username !== "string") {
        return res.status(400).json({ error: "Invalid username" });
      }

      // Validate username format
      if (username.length < 3 || username.length > 30) {
        return res.status(400).json({
          error: "Username must be between 3 and 30 characters",
        });
      }

      if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({
          error: "Username can only contain letters, numbers, and underscores",
        });
      }

      // Check if username is available
      const isAvailable = await checkUsernameAvailability(username);
      if (!isAvailable) {
        return res.status(409).json({
          error: "The Username is not Available, Please try another",
        });
      }
    }

    if (!isValidPublicKey(publicKey)) {
      return res.status(400).json({ error: "Invalid public key format" });
    }

    // Derive user ID from public key
    const userId = await deriveUserIdFromPublicKey(publicKey);

    // Check if user already exists in R2
    const existingUser = await getUserAccount(userId);
    if (existingUser) {
      return res.status(409).json({ error: "User already registered" });
    }

    // Create new user account
    const userAccount: UserAccount = {
      userId,
      publicKey,
      username: username ? username.toLowerCase() : undefined,
      createdAt: Date.now(),
    };

    // Store account in R2
    await saveUserAccount(userId, userAccount);

    // Reserve username if provided
    if (username) {
      await reserveUsername(username, userId);
    }

    // Store passphrase recovery hash in R2
    await savePassphraseRecovery(userId, passphraseHash);

    console.log(`User ${userId} registered and stored in R2`);

    return res.status(201).json({
      userId,
      username: username ? username.toLowerCase() : undefined,
      message: "Account created successfully",
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({ error: "Registration failed" });
  }
};

/**
 * POST /api/auth/challenge
 * Generate a challenge for the user to sign
 */
export const handleGetChallenge: RequestHandler = async (req, res) => {
  try {
    const { userId, publicKey } = req.body;

    if (!userId || !publicKey) {
      return res
        .status(400)
        .json({ error: "userId and publicKey are required" });
    }

    if (!isValidPublicKey(publicKey)) {
      return res.status(400).json({ error: "Invalid public key format" });
    }

    // Verify that the provided userId matches the public key
    const derivedUserId = await deriveUserIdFromPublicKey(publicKey);
    if (userId !== derivedUserId) {
      return res
        .status(403)
        .json({ error: "Public key does not match userId" });
    }

    // Check if user exists in R2
    const userAccount = await getUserAccount(userId);
    if (!userAccount) {
      return res.status(404).json({ error: "User not found" });
    }

    // Generate challenge
    const challenge = generateChallenge();
    const timestamp = Date.now();
    const expiresAt = timestamp + 5 * 60 * 1000; // 5 minutes

    const authChallenge: AuthChallenge = {
      userId,
      challenge,
      timestamp,
      expiresAt,
    };

    challenges.set(challenge, authChallenge);

    return res.status(200).json({
      challenge,
      expiresAt,
    });
  } catch (error) {
    console.error("Challenge generation error:", error);
    return res.status(500).json({ error: "Failed to generate challenge" });
  }
};

/**
 * POST /api/auth/verify
 * Verify the signed challenge and create a session
 */
export const handleVerifyChallenge: RequestHandler = async (req, res) => {
  try {
    const { userId, challenge, signature, publicKey } =
      req.body as AuthResponse & { challenge: string };

    if (!userId || !challenge || !signature || !publicKey) {
      return res.status(400).json({
        error: "userId, challenge, signature, and publicKey are required",
      });
    }

    if (!isValidPublicKey(publicKey)) {
      return res.status(400).json({ error: "Invalid public key format" });
    }

    if (!isValidSignature(signature)) {
      return res.status(400).json({ error: "Invalid signature format" });
    }

    // Retrieve challenge
    const authChallenge = challenges.get(challenge);
    if (!authChallenge) {
      return res.status(400).json({ error: "Challenge not found" });
    }

    // Check challenge expiration
    if (isChallengeExpired(authChallenge.timestamp)) {
      challenges.delete(challenge);
      return res.status(400).json({ error: "Challenge expired" });
    }

    // Verify userId matches challenge
    if (userId !== authChallenge.userId) {
      return res.status(403).json({ error: "userId does not match challenge" });
    }

    // Verify user exists in R2
    const userAccount = await getUserAccount(userId);
    if (!userAccount) {
      return res.status(404).json({ error: "User not found" });
    }

    // Verify public key matches stored user
    if (userAccount.publicKey !== publicKey) {
      return res
        .status(403)
        .json({ error: "Public key does not match registered user" });
    }

    // Verify the signature
    const isSignatureValid = verifySignedChallenge(
      challenge,
      signature,
      publicKey,
    );
    if (!isSignatureValid) {
      return res.status(403).json({ error: "Invalid signature" });
    }

    // Clean up used challenge
    challenges.delete(challenge);

    // Create session
    const sessionToken = uuidv4();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const sessionData: SessionData = {
      userId,
      publicKey,
      sessionToken,
      expiresAt,
    };

    // Save to in-memory cache
    sessions.set(sessionToken, sessionData);

    // Also save to R2 for persistence across server restarts
    try {
      await saveSession(sessionToken, sessionData);
      console.log(`Session ${sessionToken} saved to R2`);
    } catch (r2Error) {
      console.error("Failed to save session to R2:", r2Error);
      // Continue anyway - session is in memory, but won't survive server restart
    }

    return res.status(200).json({
      sessionToken,
      userId,
      expiresAt,
      message: "Authentication successful",
    });
  } catch (error) {
    console.error("Challenge verification error:", error);
    return res.status(500).json({ error: "Verification failed" });
  }
};

/**
 * GET /api/auth/verify-session
 * Verify a session token
 */
export const handleVerifySession: RequestHandler = async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace("Bearer ", "");

    if (!sessionToken) {
      return res.status(401).json({ error: "No session token provided" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    return res.status(200).json({
      userId: session.userId,
      publicKey: session.publicKey,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("Session verification error:", error);
    return res.status(500).json({ error: "Verification failed" });
  }
};

/**
 * GET /api/auth/public-key/:userId
 * Get a user's public key for encryption
 * Public endpoint - anyone can request this
 */
export const handleGetPublicKey: RequestHandler = async (req, res) => {
  try {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId : "";

    if (!userId) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    const userAccount = await getUserAccount(userId);
    if (!userAccount) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      userId,
      publicKey: userAccount.publicKey,
    });
  } catch (error) {
    console.error("Get public key error:", error);
    return res.status(500).json({ error: "Failed to retrieve public key" });
  }
};

/**
 * POST /api/auth/recover
 * Recover account using passphrase hash
 */
export const handleRecoverAccount: RequestHandler = async (req, res) => {
  try {
    const { passphraseHash } = req.body;

    if (!passphraseHash || typeof passphraseHash !== "string") {
      return res.status(400).json({ error: "Passphrase hash is required" });
    }

    // In production, you would search through R2 to find the user with matching passphrase
    // For now, we'll require the userId as well (user provides it)
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Get passphrase recovery data
    const recoveryData = await getPassphraseRecovery(userId);
    if (!recoveryData) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Verify passphrase hash matches
    if (recoveryData.passphraseHash !== passphraseHash) {
      return res.status(403).json({ error: "Invalid passphrase" });
    }

    // Get user account
    const userAccount = await getUserAccount(userId);
    if (!userAccount) {
      return res.status(404).json({ error: "User account not found" });
    }

    // Return public key for the user to generate a challenge
    return res.status(200).json({
      userId,
      publicKey: userAccount.publicKey,
      message:
        "Account recovered successfully. Please sign the challenge to complete authentication.",
    });
  } catch (error) {
    console.error("Account recovery error:", error);
    return res.status(500).json({ error: "Account recovery failed" });
  }
};

/**
 * POST /api/auth/save-encrypted-keypair
 * Save encrypted keypair to R2 for cross-device recovery
 * Client encrypts the keypair before sending, server stores ciphertext only
 */
export const handleSaveEncryptedKeypair: RequestHandler = async (req, res) => {
  try {
    const { userId, encryptedData, salt, iv } = req.body;

    if (!userId || !encryptedData || !salt || !iv) {
      return res.status(400).json({
        error: "userId, encryptedData, salt, and iv are required",
      });
    }

    if (typeof userId !== "string") {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (typeof encryptedData !== "string") {
      return res.status(400).json({ error: "Invalid encryptedData" });
    }

    if (typeof salt !== "string") {
      return res.status(400).json({ error: "Invalid salt" });
    }

    if (typeof iv !== "string") {
      return res.status(400).json({ error: "Invalid iv" });
    }

    // Verify user exists
    const userAccount = await getUserAccount(userId);
    if (!userAccount) {
      return res.status(404).json({ error: "User not found" });
    }

    // Save encrypted keypair to R2
    await saveEncryptedKeypair(userId, encryptedData, salt, iv);

    return res.status(200).json({
      message: "Encrypted keypair saved successfully",
    });
  } catch (error) {
    console.error("Save encrypted keypair error:", error);
    return res.status(500).json({ error: "Failed to save encrypted keypair" });
  }
};

/**
 * GET /api/auth/encrypted-keypair/:userId
 * Get encrypted keypair from R2 for cross-device recovery
 * Server returns ciphertext only (client decrypts locally)
 */
export const handleGetEncryptedKeypair: RequestHandler = async (req, res) => {
  try {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId : "";

    if (!userId) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // Verify user exists
    const userAccount = await getUserAccount(userId);
    if (!userAccount) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get encrypted keypair from R2
    const encryptedKeypair = await getEncryptedKeypair(userId);
    if (!encryptedKeypair) {
      return res.status(404).json({ error: "Encrypted keypair not found" });
    }

    return res.status(200).json({
      userId,
      ...encryptedKeypair,
    });
  } catch (error) {
    console.error("Get encrypted keypair error:", error);
    return res
      .status(500)
      .json({ error: "Failed to retrieve encrypted keypair" });
  }
};

/**
 * POST /api/auth/logout
 * Invalidate a session
 */
export const handleLogout: RequestHandler = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;

    if (!sessionToken) {
      return res.status(400).json({ error: "No session token provided" });
    }

    // Delete from in-memory cache
    sessions.delete(sessionToken);

    // Also delete from R2
    try {
      await deleteSessionData(sessionToken);
      console.log(`Session ${sessionToken} deleted from R2`);
    } catch (error) {
      console.error("Failed to delete session from R2:", error);
      // Continue anyway - session is removed from memory
    }

    return res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ error: "Logout failed" });
  }
};

/**
 * Utility: Get session from token
 * Used by other routes to verify authentication
 * Checks in-memory first, then falls back to R2 for persistence
 */
export async function getSessionFromToken(
  sessionToken: string,
): Promise<SessionData | null> {
  // First check in-memory cache
  const cachedSession = sessions.get(sessionToken);
  if (cachedSession) {
    // Check if expired
    if (cachedSession.expiresAt < Date.now()) {
      sessions.delete(sessionToken);
      return null;
    }
    return cachedSession;
  }

  // If not in memory, try R2 (for persistence across server restarts)
  try {
    const sessionData = await getSessionData(sessionToken);
    if (!sessionData) return null;

    // Check if expired
    if (sessionData.expiresAt < Date.now()) {
      // Clean up expired session from R2
      try {
        await deleteSessionData(sessionToken);
      } catch (error) {
        console.error("Failed to delete expired session from R2:", error);
      }
      return null;
    }

    // Restore to in-memory cache for faster subsequent lookups
    sessions.set(sessionToken, sessionData);
    return sessionData;
  } catch (error) {
    console.error("Error retrieving session from R2:", error);
    return null;
  }
}

/**
 * Utility: Get all users (admin only - for demo)
 */
export function getAllUsers(): UserAccount[] {
  return Array.from(users.values());
}

/**
 * Utility: Get user by ID
 */
export function getUserById(userId: string): UserAccount | undefined {
  return users.get(userId);
}
