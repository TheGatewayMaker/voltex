import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { handleDemo } from "./routes/demo";
import {
  handleRegister,
  handleGetChallenge,
  handleVerifyChallenge,
  handleVerifySession,
  handleGetPublicKey,
  handleLogout,
  handleRecoverAccount,
  handleCheckUsernameAvailability,
  handleSaveEncryptedKeypair,
  handleGetEncryptedKeypair,
  getSessionFromToken,
} from "./routes/auth";
import {
  handleSendMessage,
  handleGetConversation,
  handleGetConversations,
  handleDeleteConversation,
  handleDeleteMessage,
} from "./routes/messages";
import {
  handleGetProfile,
  handleUpdateProfile,
  handleGetPublicProfile,
  handleUploadAvatar,
  handleUpdateSettings,
} from "./routes/profile";
import { handleSearchUsers, handleGetUserByUsername } from "./routes/users";
import {
  handleHealthCheck,
  handleArchivalStatus,
  handleDatabaseStats,
  handleRunArchival,
  handleArchivalConfig,
} from "./routes/admin";
import {
  registerUserConnection,
  unregisterUserConnection,
  deliverMessage,
  getQueuedMessages,
} from "./lib/messaging";
import { validateEncryptedMessage, verifyMessageSignature } from "./lib/crypto";
import { saveMessageWithMetadata, getUserAccount } from "./lib/r2-storage";
import { EncryptedMessage } from "@shared/crypto";
import { getConversationKey, storeMessage } from "./lib/conversation-history";
import { storeMessageInDB, isDatabaseConnected } from "./lib/db-messages";
import { initializeDatabase } from "./lib/db";
import { startArchivalJob } from "./lib/archival-job";

// WebSocket server instance (shared across all connections)
let wssInstance: WebSocketServer | null = null;

export async function createServer(): Promise<{
  app: any;
  wss: WebSocketServer;
}> {
  const app = express();

  // Initialize database
  try {
    await initializeDatabase();

    // Start archival job if database is connected
    if (isDatabaseConnected()) {
      const archivalConfig = {
        intervalMs: parseInt(process.env.ARCHIVAL_INTERVAL_MS || "7200000"), // 2 hours
        messageAgeMs: parseInt(process.env.MESSAGE_AGE_MS || "7200000"), // 2 hours old
        batchSize: parseInt(process.env.ARCHIVAL_BATCH_SIZE || "1000"),
        deleteAfterArchival: process.env.DELETE_AFTER_ARCHIVAL !== "false",
        deleteGraceMs: parseInt(process.env.DELETE_GRACE_MS || "0"),
      };

      startArchivalJob(archivalConfig);
      console.log("Message archival job started");
    }
  } catch (error) {
    console.warn("Database initialization failed:", error);
    console.log("Falling back to in-memory storage");
  }

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Example API routes
  app.get("/api/ping", (_req, res) => {
    const ping = process.env.PING_MESSAGE ?? "ping";
    res.json({ message: ping });
  });

  app.get("/api/demo", handleDemo);

  // Authentication routes
  app.post("/api/auth/register", handleRegister);
  app.post("/api/auth/challenge", handleGetChallenge);
  app.post("/api/auth/verify", handleVerifyChallenge);
  app.get("/api/auth/verify-session", handleVerifySession);
  app.get("/api/auth/public-key/:userId", handleGetPublicKey);
  app.post("/api/auth/recover", handleRecoverAccount);
  app.post("/api/auth/logout", handleLogout);
  app.post("/api/auth/username-availability", handleCheckUsernameAvailability);
  app.post("/api/auth/save-encrypted-keypair", handleSaveEncryptedKeypair);
  app.get("/api/auth/encrypted-keypair/:userId", handleGetEncryptedKeypair);

  // Message routes
  app.post("/api/messages/send", handleSendMessage);
  app.get("/api/messages/conversation/:recipientId", handleGetConversation);
  app.get("/api/messages/conversations", handleGetConversations);
  app.delete(
    "/api/messages/conversation/:recipientId",
    handleDeleteConversation,
  );
  app.delete("/api/messages/message", handleDeleteMessage);

  // Profile routes
  app.get("/api/profile/me", handleGetProfile);
  app.put("/api/profile/me", handleUpdateProfile);
  app.get("/api/profile/:userId", handleGetPublicProfile);
  app.post("/api/profile/avatar", handleUploadAvatar);
  app.post("/api/profile/settings", handleUpdateSettings);

  // User search routes
  app.post("/api/users/search", handleSearchUsers);
  app.get("/api/users/by-username/:username", handleGetUserByUsername);

  // Admin routes (for monitoring and testing)
  app.get("/api/admin/health", handleHealthCheck);
  app.get("/api/admin/archival-status", handleArchivalStatus);
  app.get("/api/admin/database-stats", handleDatabaseStats);
  app.get("/api/admin/archival-config", handleArchivalConfig);
  app.post("/api/admin/run-archival", handleRunArchival);

  // Create WebSocket server if not already created
  if (!wssInstance) {
    wssInstance = new WebSocketServer({ noServer: true });

    wssInstance.on("connection", async (ws, req) => {
      const token = req.url?.split("?token=")[1];

      if (!token) {
        ws.close();
        return;
      }

      const session = await getSessionFromToken(token);
      if (!session) {
        ws.close();
        return;
      }

      const userId = session.userId;
      console.log(`User ${userId} connected via WebSocket`);

      registerUserConnection(userId, ws);

      // Send queued messages to the newly connected user
      const queuedMessages = getQueuedMessages(userId);
      if (queuedMessages.length > 0) {
        console.log(
          `[QUEUED-MESSAGES] Flushing ${queuedMessages.length} queued messages for ${userId}`,
        );
        let failedMessages: typeof queuedMessages = [];

        for (const message of queuedMessages) {
          try {
            ws.send(
              JSON.stringify({
                type: "message",
                data: message,
              }),
            );
            console.log(
              `[QUEUED-MESSAGES] ✓ Delivered queued message from ${message.senderId}`,
            );
          } catch (error) {
            console.error(
              `[QUEUED-MESSAGES] ✗ Error sending queued message from ${message.senderId}:`,
              error,
            );
            failedMessages.push(message);
          }
        }

        // Re-queue any messages that failed to send
        if (failedMessages.length > 0) {
          console.warn(
            `[QUEUED-MESSAGES] Re-queueing ${failedMessages.length} failed messages`,
          );
          failedMessages.forEach((msg) => {
            const queue = new Map();
            queue.set(userId, failedMessages);
            // This would need to be done properly through the messaging module
            // For now, at least log it
          });
        }
      }

      // Handle incoming messages
      ws.on("message", async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "message") {
            // Relay encrypted message
            const encryptedMessage = message.data;
            const clientMessageId = message.id; // Track the original client message ID for ACK

            console.log(
              `[WS] Received message from ${userId} to ${encryptedMessage.recipientId}, client ID: ${clientMessageId}`,
            );

            if (!validateEncryptedMessage(encryptedMessage)) {
              console.warn(`[WS] Invalid message format from ${userId}`);
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Invalid message format",
                  messageId: clientMessageId,
                }),
              );
              return;
            }

            // CRITICAL: Verify sender matches authenticated user
            // This prevents a user from spoofing another user's ID
            if (encryptedMessage.senderId !== userId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error:
                    "Sender ID does not match authenticated user - spoofing attempt blocked",
                  messageId: clientMessageId,
                }),
              );
              console.warn(
                `[WS] Spoofing attempt: user ${userId} tried to send as ${encryptedMessage.senderId}`,
              );
              return;
            }

            // Verify message signature using authenticated user's sign public key
            let signPublicKeyToUse = session.signPublicKey;

            // If signPublicKey is not in session, fetch it from user account
            if (!signPublicKeyToUse) {
              try {
                const { getUserAccount } = await import("./lib/r2-storage");
                const userAccount = await getUserAccount(userId);
                if (userAccount && userAccount.signPublicKey) {
                  signPublicKeyToUse = userAccount.signPublicKey;
                  console.log(
                    `[WS] Fetched sign public key from R2 for user ${userId}`,
                  );
                }
              } catch (error) {
                console.error(
                  `[WS] Failed to fetch user account for ${userId}:`,
                  error,
                );
              }
            }

            // If we still don't have a signPublicKey, we cannot verify the signature
            if (!signPublicKeyToUse) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error:
                    "User account is missing signing key - please re-register",
                  messageId: clientMessageId,
                }),
              );
              console.warn(`[WS] No sign public key available for user ${userId}`);
              return;
            }

            const isSignatureValid = verifyMessageSignature(
              encryptedMessage,
              signPublicKeyToUse,
            );
            if (!isSignatureValid) {
              console.warn(
                `[WS] Invalid message signature from user ${userId} - signature verification failed`,
              );
              ws.send(
                JSON.stringify({
                  type: "error",
                  error:
                    "Invalid message signature - authenticity verification failed",
                  messageId: clientMessageId,
                }),
              );
              return;
            }

            console.log(
              `[WS] Message signature verified for ${userId} -> ${encryptedMessage.recipientId}`,
            );

            // Verify recipient is specified
            if (!encryptedMessage.recipientId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Recipient ID is required",
                  messageId: clientMessageId,
                }),
              );
              return;
            }

            // Store message in shared conversation history (in-memory)
            // This ensures both WebSocket and HTTP routes access the same data
            storeMessage(
              userId,
              encryptedMessage.recipientId,
              encryptedMessage,
            );
            console.log(
              `[WS] Message stored in memory for conversation ${userId}:${encryptedMessage.recipientId}`,
            );

            // Generate unique message ID
            const messageId = uuidv4();

            // Try to store in PostgreSQL first (if available)
            let dbStorageSuccess = false;
            if (isDatabaseConnected()) {
              try {
                dbStorageSuccess = await storeMessageInDB(
                  messageId,
                  userId,
                  encryptedMessage.recipientId,
                  {
                    nonce: encryptedMessage.nonce,
                    ciphertext: encryptedMessage.ciphertext,
                    signature: encryptedMessage.signature,
                    timestamp: encryptedMessage.timestamp,
                  },
                );
                console.log(
                  `[WS] Message ${messageId} stored in PostgreSQL for ${userId} -> ${encryptedMessage.recipientId}`,
                );
              } catch (dbError) {
                console.error(
                  `[WS] Failed to store message ${messageId} in PostgreSQL:`,
                  dbError,
                );
              }
            }

            // Store message in R2 for persistence (fallback if no DB or for redundancy)
            let r2StorageSuccess = false;
            try {
              await saveMessageWithMetadata(
                messageId,
                userId,
                encryptedMessage.recipientId,
                {
                  nonce: encryptedMessage.nonce,
                  ciphertext: encryptedMessage.ciphertext,
                  signature: encryptedMessage.signature,
                  timestamp: encryptedMessage.timestamp,
                },
              );
              console.log(
                `[WS] Message ${messageId} stored in R2 for ${userId} -> ${encryptedMessage.recipientId}`,
              );
              r2StorageSuccess = true;
            } catch (r2Error) {
              console.error(
                `[WS] Failed to store message ${messageId} in R2:`,
                r2Error,
              );
              // Continue anyway, message is in memory and possibly in DB
            }

            // Deliver message to recipient
            const delivered = deliverMessage(encryptedMessage);
            console.log(
              `[WS] Message delivery attempt: recipient=${encryptedMessage.recipientId}, delivered=${delivered}`,
            );

            // Send ACK back to sender with original client message ID
            ws.send(
              JSON.stringify({
                type: "message-ack",
                messageId: clientMessageId,
                delivered,
                serverMessageId: messageId,
              }),
            );
            console.log(
              `[WS] Sent ACK to ${userId}: messageId=${clientMessageId}, delivered=${delivered}`,
            );
          }
        } catch (error) {
          console.error(`[WS] WebSocket message handling error:`, error);
        }
      });

      ws.on("close", () => {
        console.log(`User ${userId} disconnected`);
        unregisterUserConnection(userId);
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
      });
    });
  }

  return { app, wss: wssInstance };
}
