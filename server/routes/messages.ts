import { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import { EncryptedMessage } from "@shared/crypto";
import { getSessionFromToken } from "./auth";
import {
  saveMessageWithMetadata,
  getConversationMessages,
  getUserAccount,
} from "../lib/r2-storage";
import { verifyMessageSignature } from "../lib/crypto";

// In-memory message storage (messages are also stored in R2 for persistence)
// Structure: { "senderId:recipientId": [messages] }
const conversationHistory = new Map<string, EncryptedMessage[]>();

/**
 * Helper: Get conversation key (ordered to support bidirectional chats)
 */
function getConversationKey(userId1: string, userId2: string): string {
  const sorted = [userId1, userId2].sort();
  return `${sorted[0]}:${sorted[1]}`;
}

/**
 * POST /api/messages/send
 * Store an encrypted message with signature verification
 */
export const handleSendMessage: RequestHandler = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;

    if (!sessionToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const { recipientId, nonce, ciphertext, signature, timestamp } = req.body;

    if (!recipientId || !nonce || !ciphertext || !signature || !timestamp) {
      return res.status(400).json({
        error:
          "Missing required fields: recipientId, nonce, ciphertext, signature, timestamp",
      });
    }

    // Validate signature format (64 bytes base64-encoded)
    if (typeof signature !== "string" || signature.length === 0) {
      return res.status(400).json({
        error: "Invalid signature format",
      });
    }

    // Create encrypted message object
    const message: EncryptedMessage = {
      nonce,
      ciphertext,
      signature,
      senderId: session.userId,
      recipientId,
      timestamp,
    };

    // Verify message signature using sender's sign public key
    let signPublicKeyToUse = session.signPublicKey;

    // If signPublicKey is not in session, fetch it from user account
    if (!signPublicKeyToUse) {
      try {
        const userAccount = await getUserAccount(session.userId);
        if (userAccount && userAccount.signPublicKey) {
          signPublicKeyToUse = userAccount.signPublicKey;
        }
      } catch (error) {
        console.error("Failed to fetch user account for signPublicKey:", error);
      }
    }

    // If we still don't have a signPublicKey, we cannot verify the signature
    if (!signPublicKeyToUse) {
      console.warn(`No sign public key available for user ${session.userId}`);
      return res.status(403).json({
        error: "User account is missing signing key - please re-register",
      });
    }

    const isSignatureValid = verifyMessageSignature(
      message,
      signPublicKeyToUse,
    );
    if (!isSignatureValid) {
      console.warn(
        `Invalid message signature from ${session.userId} to ${recipientId}`,
      );
      return res.status(403).json({
        error: "Invalid message signature - authenticity verification failed",
      });
    }

    // Generate unique message ID
    const messageId = uuidv4();

    // Store in conversation history (in-memory for current session)
    const conversationKey = getConversationKey(session.userId, recipientId);
    if (!conversationHistory.has(conversationKey)) {
      conversationHistory.set(conversationKey, []);
    }

    const messages = conversationHistory.get(conversationKey)!;
    messages.push(message);

    // Also store in R2 for persistence
    let r2StorageSuccess = false;
    try {
      await saveMessageWithMetadata(messageId, session.userId, recipientId, {
        nonce,
        ciphertext,
        signature,
        timestamp,
      });
      console.log(`Message ${messageId} stored in R2`);
      r2StorageSuccess = true;
    } catch (r2Error) {
      console.error("Failed to store message in R2:", r2Error);
      // Continue anyway, message is in memory, but flag for client
    }

    // Keep only last 1000 messages per conversation
    if (messages.length > 1000) {
      messages.shift();
    }

    return res.status(200).json({
      success: true,
      messageId: `${timestamp}-${session.userId}`,
      timestamp,
      persisted: r2StorageSuccess,
    });
  } catch (error) {
    console.error("Send message error:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
};

/**
 * GET /api/messages/conversation/:recipientId
 * Retrieve conversation history (from memory + R2 persistence)
 */
export const handleGetConversation: RequestHandler = async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace("Bearer ", "");
    if (!sessionToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const { recipientId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    if (!recipientId) {
      return res.status(400).json({ error: "recipientId is required" });
    }

    // Get conversation history from memory
    const conversationKey = getConversationKey(session.userId, recipientId);
    let allMessages = conversationHistory.get(conversationKey) || [];

    // If in-memory is empty, try to load from R2 persistence
    if (allMessages.length === 0) {
      try {
        const persistedMessages = await getConversationMessages(
          session.userId,
          recipientId,
          1000, // Load up to 1000 messages from R2
          0,
        );

        if (persistedMessages.length > 0) {
          // Load persisted messages into memory cache
          conversationHistory.set(conversationKey, persistedMessages);
          allMessages = persistedMessages;
          console.log(
            `Loaded ${persistedMessages.length} messages from R2 for conversation ${conversationKey}`,
          );
        }
      } catch (r2Error) {
        console.error("Error loading messages from R2:", r2Error);
        // Continue with in-memory data (if available)
      }
    }

    // Apply pagination
    const paginatedMessages = allMessages
      .slice(
        Math.max(0, allMessages.length - (offset + limit)),
        allMessages.length - offset,
      )
      .reverse(); // Newest first

    return res.status(200).json({
      recipientId,
      messages: paginatedMessages,
      total: allMessages.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Get conversation error:", error);
    return res.status(500).json({ error: "Failed to retrieve conversation" });
  }
};

/**
 * GET /api/messages/conversations
 * Get list of conversations (users you've chatted with)
 */
export const handleGetConversations: RequestHandler = async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace("Bearer ", "");
    if (!sessionToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    // Get all conversations for this user
    const conversations = new Map<
      string,
      { userId: string; lastMessage: string; timestamp: number }
    >();

    for (const [conversationKey, messages] of conversationHistory.entries()) {
      const [user1, user2] = conversationKey.split(":");
      const otherUserId = user1 === session.userId ? user2 : user1;

      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        conversations.set(otherUserId, {
          userId: otherUserId,
          lastMessage: lastMessage.ciphertext.substring(0, 50),
          timestamp: lastMessage.timestamp,
        });
      }
    }

    // Sort by timestamp (newest first)
    const sorted = Array.from(conversations.values()).sort(
      (a, b) => b.timestamp - a.timestamp,
    );

    return res.status(200).json({
      conversations: sorted,
      count: sorted.length,
    });
  } catch (error) {
    console.error("Get conversations error:", error);
    return res.status(500).json({ error: "Failed to retrieve conversations" });
  }
};

/**
 * DELETE /api/messages/conversation/:recipientId
 * Delete conversation history
 */
export const handleDeleteConversation: RequestHandler = async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace("Bearer ", "");
    if (!sessionToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const { recipientId } = req.params;

    if (!recipientId) {
      return res.status(400).json({ error: "recipientId is required" });
    }

    const conversationKey = getConversationKey(session.userId, recipientId);
    conversationHistory.delete(conversationKey);

    return res.status(200).json({ success: true, deleted: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
};

/**
 * Utility: Get all messages (admin/testing)
 */
export function getAllMessages(): Map<string, EncryptedMessage[]> {
  return conversationHistory;
}

/**
 * Utility: Clear all messages (testing)
 */
export function clearAllMessages(): void {
  conversationHistory.clear();
}
