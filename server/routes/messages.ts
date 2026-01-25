import { RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import { EncryptedMessage } from "@shared/crypto";
import { getSessionFromToken } from "./auth";
import {
  saveMessageWithMetadata,
  getConversationMessages as getConversationMessagesFromR2,
  getUserAccount,
  getUserConversationsFromR2,
} from "../lib/r2-storage";
import { verifyMessageSignature } from "../lib/crypto";
import { deliverMessage } from "../lib/messaging";
import {
  getConversationKey,
  storeMessage,
  getConversationMessages as getStoredMessages,
  deleteMessage as deleteStoredMessage,
  deleteConversation as deleteStoredConversation,
  getUserConversations,
} from "../lib/conversation-history";
import {
  storeMessageInDB,
  getConversationMessagesFromDB,
  getUserConversationsFromDB,
  deleteMessageFromDB,
  deleteConversationFromDB,
  isDatabaseConnected,
} from "../lib/db-messages";

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
      return res.status(401).json({ error: "Unauthorized - no session token" });
    }

    let session;
    try {
      session = await getSessionFromToken(sessionToken);
    } catch (sessionError) {
      console.error("Session validation error:", sessionError);
      return res.status(401).json({ error: "Invalid session token" });
    }

    if (!session) {
      return res.status(401).json({ error: "Session not found or expired" });
    }

    const { recipientId, nonce, ciphertext, signature, timestamp } = req.body;

    if (!recipientId || !nonce || !ciphertext || !signature || !timestamp) {
      return res.status(400).json({
        error:
          "Missing required fields: recipientId, nonce, ciphertext, signature, timestamp",
      });
    }

    // Validate timestamp format and value
    if (typeof timestamp !== "number" || timestamp <= 0) {
      return res.status(400).json({
        error: "Invalid timestamp - must be a positive number",
      });
    }

    // Ensure timestamp is not too far in the past or future (allow 24 hour clock skew)
    const now = Date.now();
    const MAX_CLOCK_SKEW = 24 * 60 * 60 * 1000; // 24 hours
    if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW) {
      console.warn(
        `Message timestamp ${timestamp} is too far from server time ${now} (difference: ${Math.abs(now - timestamp)}ms)`,
      );
      return res.status(400).json({
        error:
          "Message timestamp is too far from server time. Please check your device clock.",
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
        return res.status(500).json({
          error: `Failed to fetch user account: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }

    // If we still don't have a signPublicKey, we cannot verify the signature
    if (!signPublicKeyToUse) {
      console.warn(
        `No sign public key available for user ${session.userId}. ` +
          `Session has signPublicKey: ${!!session.signPublicKey}, ` +
          `User account found: ${!!userAccount}`,
      );
      return res.status(403).json({
        error:
          "User account is missing signing key. Please sign out and sign in again, or create a new account",
      });
    }

    let isSignatureValid;
    try {
      isSignatureValid = verifyMessageSignature(message, signPublicKeyToUse);
    } catch (verifyError) {
      console.error("Signature verification error:", verifyError);
      return res.status(500).json({
        error: `Signature verification failed: ${verifyError instanceof Error ? verifyError.message : "Unknown error"}`,
      });
    }

    if (!isSignatureValid) {
      console.warn(
        `Invalid message signature from ${session.userId} to ${recipientId}. ` +
          `Signature: ${signature.substring(0, 20)}...`,
      );
      return res.status(403).json({
        error: "Invalid message signature - authenticity verification failed",
      });
    }

    console.log(
      `Message signature verified successfully for user ${session.userId}`,
    );

    // Generate unique message ID
    const messageId = uuidv4();

    // Store in shared conversation history (in-memory for current session)
    // This ensures both WebSocket and HTTP routes access the same data
    storeMessage(session.userId, recipientId, message);

    // Store in both PostgreSQL and R2 in PARALLEL for speed
    // Don't wait for one to complete before starting the other
    let dbStorageSuccess = false;
    let r2StorageSuccess = false;

    const storagePromises: Promise<any>[] = [];

    // Parallel storage in PostgreSQL (if available)
    if (isDatabaseConnected()) {
      storagePromises.push(
        storeMessageInDB(messageId, session.userId, recipientId, {
          nonce,
          ciphertext,
          signature,
          timestamp,
        })
          .then((success) => {
            dbStorageSuccess = success;
            if (success) {
              console.log(`Message ${messageId} stored in PostgreSQL`);
            }
            return success;
          })
          .catch((dbError) => {
            console.error("Failed to store message in PostgreSQL:", dbError);
          }),
      );
    }

    // Parallel storage in R2 for persistence
    storagePromises.push(
      saveMessageWithMetadata(messageId, session.userId, recipientId, {
        nonce,
        ciphertext,
        signature,
        timestamp,
      })
        .then(() => {
          console.log(`Message ${messageId} stored in R2`);
          r2StorageSuccess = true;
        })
        .catch((r2Error) => {
          console.error("Failed to store message in R2:", r2Error);
        }),
    );

    // Wait for all storage operations to complete (in parallel, not sequential)
    if (storagePromises.length > 0) {
      await Promise.all(storagePromises);
    }

    // Attempt to deliver message to recipient in real-time (if connected)
    const delivered = deliverMessage(message);
    if (delivered) {
      console.log(`Message delivered in real-time to ${recipientId}`);
    } else {
      console.log(
        `Message queued for ${recipientId} (not currently connected)`,
      );
    }

    return res.status(200).json({
      success: true,
      messageId: `${timestamp}-${session.userId}`,
      timestamp,
      persisted: dbStorageSuccess || r2StorageSuccess,
      persistedInDB: dbStorageSuccess,
      persistedInR2: r2StorageSuccess,
      delivered,
    });
  } catch (error) {
    console.error("Unexpected error in send message handler:", error);
    // Return the actual error message to help with debugging
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return res
      .status(500)
      .json({ error: `Failed to send message: ${errorMessage}` });
  }
};

/**
 * GET /api/messages/conversation/:recipientId
 * Retrieve conversation history (from PostgreSQL + R2 for older messages)
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

    // Try to get recent messages from PostgreSQL first
    let allMessages = [];
    let fromDatabase = false;

    if (isDatabaseConnected()) {
      try {
        const dbMessages = await getConversationMessagesFromDB(
          session.userId,
          recipientId,
          1000, // Load up to 1000 recent messages from DB
          0,
        );

        if (dbMessages && dbMessages.length > 0) {
          // Convert database message format to EncryptedMessage format
          allMessages = dbMessages.map((msg) => ({
            id: msg.id, // Include unique message ID for deduplication
            nonce: msg.nonce,
            ciphertext: msg.ciphertext,
            signature: msg.signature,
            senderId: msg.sender_id || msg.senderId,
            recipientId: msg.recipient_id || msg.recipientId,
            timestamp: msg.timestamp,
          }));
          fromDatabase = true;
          console.log(
            `Loaded ${dbMessages.length} messages from PostgreSQL for conversation ${session.userId}:${recipientId}`,
          );
        }
      } catch (dbError) {
        console.error("Error loading messages from PostgreSQL:", dbError);
      }
    }

    // If database is empty or disabled, try R2 persistence
    if (allMessages.length === 0) {
      try {
        const r2Messages = await getConversationMessagesFromR2(
          session.userId,
          recipientId,
          1000, // Load up to 1000 messages from R2
          0,
        );

        if (r2Messages && r2Messages.length > 0) {
          allMessages = r2Messages;
          console.log(
            `Loaded ${r2Messages.length} messages from R2 for conversation ${session.userId}:${recipientId}`,
          );
        }
      } catch (r2Error) {
        console.error("Error loading messages from R2:", r2Error);
      }
    } else if (allMessages.length < limit + offset) {
      // If we have fewer messages than requested, try to load older ones from R2
      try {
        const r2Messages = await getConversationMessagesFromR2(
          session.userId,
          recipientId,
          1000,
          0,
        );

        if (r2Messages && r2Messages.length > 0) {
          allMessages = [...allMessages, ...r2Messages];
          console.log(
            `Loaded ${r2Messages.length} older messages from R2 for conversation ${session.userId}:${recipientId}`,
          );
        }
      } catch (r2Error) {
        console.error("Error loading older messages from R2:", r2Error);
      }
    }

    // Also get conversation from in-memory cache to ensure real-time messages are included
    const inMemoryMessages = getStoredMessages(session.userId, recipientId);
    if (inMemoryMessages.length > 0) {
      // Merge with DB messages, avoiding duplicates using message ID
      const messageIds = new Set(allMessages.map((m) => m.id || `${m.timestamp}-${m.senderId}`));
      const newMessages = inMemoryMessages.filter(
        (m) => !messageIds.has(m.id || `${m.timestamp}-${m.senderId}`),
      );
      allMessages = [...allMessages, ...newMessages];
    }

    // Sort all messages by timestamp (oldest first)
    allMessages.sort((a, b) => a.timestamp - b.timestamp);

    // Apply pagination
    const paginatedMessages = allMessages.slice(offset, offset + limit);

    return res.status(200).json({
      recipientId,
      messages: paginatedMessages,
      total: allMessages.length,
      limit,
      offset,
      source: fromDatabase ? "database+r2" : "r2+memory",
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

    // Try to get conversations from PostgreSQL first
    let userConversations = new Map<
      string,
      { lastMessage: any; timestamp: number }
    >();
    let fromDatabase = false;

    if (isDatabaseConnected()) {
      try {
        userConversations = await getUserConversationsFromDB(session.userId);
        if (userConversations.size > 0) {
          fromDatabase = true;
          console.log(
            `Loaded ${userConversations.size} conversations from PostgreSQL for user ${session.userId}`,
          );
        }
      } catch (dbError) {
        console.error("Error loading conversations from PostgreSQL:", dbError);
      }
    }

    // If database is empty or disabled, try R2 persistence
    if (userConversations.size === 0) {
      try {
        userConversations = await getUserConversationsFromR2(session.userId);
        console.log(
          `Loaded ${userConversations.size} conversations from R2 for user ${session.userId}`,
        );
      } catch (r2Error) {
        console.error("Error loading conversations from R2:", r2Error);
      }
    }

    // Also check in-memory conversations
    const inMemoryConversations = getUserConversations(session.userId);
    if (inMemoryConversations.size > 0) {
      // Merge with database conversations, newer timestamps win
      for (const [userId, data] of inMemoryConversations) {
        const existing = userConversations.get(userId);
        if (!existing || data.timestamp > existing.timestamp) {
          userConversations.set(userId, data);
        }
      }
    }

    // Convert to API response format
    const conversations = Array.from(userConversations.entries()).map(
      ([userId, data]) => ({
        userId,
        lastMessage: data.lastMessage.ciphertext.substring(0, 50),
        timestamp: data.timestamp,
      }),
    );

    // Sort by timestamp (newest first)
    conversations.sort((a, b) => b.timestamp - a.timestamp);

    return res.status(200).json({
      conversations,
      count: conversations.length,
      source: fromDatabase ? "database+r2" : "r2+memory",
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

    // Delete from shared conversation history (in-memory)
    deleteStoredConversation(session.userId, recipientId);

    // Delete from PostgreSQL
    if (isDatabaseConnected()) {
      try {
        await deleteConversationFromDB(session.userId, recipientId);
        console.log(
          `Deleted conversation ${session.userId}:${recipientId} from PostgreSQL`,
        );
      } catch (dbError) {
        console.error(
          "Failed to delete conversation from PostgreSQL:",
          dbError,
        );
        // Continue anyway, message is already removed from memory
      }
    }

    return res.status(200).json({ success: true, deleted: true });
  } catch (error) {
    console.error("Delete conversation error:", error);
    return res.status(500).json({ error: "Failed to delete conversation" });
  }
};

/**
 * DELETE /api/messages/message/:messageId
 * Delete a specific message from conversation
 */
export const handleDeleteMessage: RequestHandler = async (req, res) => {
  try {
    const sessionToken = req.headers.authorization?.replace("Bearer ", "");
    if (!sessionToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid session" });
    }

    const { messageId, recipientId } = req.body;

    if (!messageId || !recipientId) {
      return res
        .status(400)
        .json({ error: "messageId and recipientId are required" });
    }

    // Remove from shared conversation history
    deleteStoredMessage(session.userId, recipientId, messageId);

    // Delete from PostgreSQL
    if (isDatabaseConnected()) {
      try {
        await deleteMessageFromDB(messageId);
        console.log(`Deleted message ${messageId} from PostgreSQL`);
      } catch (dbError) {
        console.error("Failed to delete message from PostgreSQL:", dbError);
        // Continue anyway, message is already removed from memory
      }
    }

    // Delete from R2 persistence
    try {
      const sortedIds = [session.userId, recipientId].sort();
      const conversationKeyR2 = `${sortedIds[0]}:${sortedIds[1]}`;
      const r2Key = `conversations/${conversationKeyR2}/${messageId}.json`;

      await import("../lib/r2-storage").then((module) =>
        module.deleteFromR2("voltex-messages", r2Key),
      );
    } catch (r2Error) {
      console.error("Failed to delete message from R2:", r2Error);
      // Continue anyway, message is already removed from memory and DB
    }

    return res.status(200).json({ success: true, deleted: true });
  } catch (error) {
    console.error("Delete message error:", error);
    return res.status(500).json({ error: "Failed to delete message" });
  }
};
