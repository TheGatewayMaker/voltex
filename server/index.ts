import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
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
  registerUserConnection,
  unregisterUserConnection,
  deliverMessage,
  getQueuedMessages,
} from "./lib/messaging";
import { validateEncryptedMessage, verifyMessageSignature } from "./lib/crypto";

// WebSocket server instance (shared across all connections)
let wssInstance: WebSocketServer | null = null;

export function createServer() {
  const app = express();

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

  // Profile routes
  app.get("/api/profile/me", handleGetProfile);
  app.put("/api/profile/me", handleUpdateProfile);
  app.get("/api/profile/:userId", handleGetPublicProfile);
  app.post("/api/profile/avatar", handleUploadAvatar);
  app.post("/api/profile/settings", handleUpdateSettings);

  // User search routes
  app.post("/api/users/search", handleSearchUsers);
  app.get("/api/users/by-username/:username", handleGetUserByUsername);

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
        queuedMessages.forEach((message) => {
          try {
            ws.send(
              JSON.stringify({
                type: "message",
                data: message,
              }),
            );
          } catch (error) {
            console.error("Error sending queued message:", error);
          }
        });
      }

      // Handle incoming messages
      ws.on("message", (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === "message") {
            // Relay encrypted message
            const encryptedMessage = message.data;

            if (!validateEncryptedMessage(encryptedMessage)) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Invalid message format",
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
                }),
              );
              console.warn(
                `Spoofing attempt: user ${userId} tried to send as ${encryptedMessage.senderId}`,
              );
              return;
            }

            // Verify message signature using authenticated user's sign public key
            let signPublicKeyToUse = session.signPublicKey;

            // If signPublicKey is not in session, fetch it from user account
            if (!signPublicKeyToUse) {
              try {
                const userAccount = await (
                  await import("./lib/r2-storage")
                ).getUserAccount(userId);
                if (userAccount && userAccount.signPublicKey) {
                  signPublicKeyToUse = userAccount.signPublicKey;
                }
              } catch (error) {
                console.error("Failed to fetch user account for signPublicKey:", error);
              }
            }

            // If we still don't have a signPublicKey, we cannot verify the signature
            if (!signPublicKeyToUse) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "User account is missing signing key - please re-register",
                }),
              );
              console.warn(`No sign public key available for user ${userId}`);
              return;
            }

            const isSignatureValid = verifyMessageSignature(
              encryptedMessage,
              signPublicKeyToUse,
            );
            if (!isSignatureValid) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error:
                    "Invalid message signature - authenticity verification failed",
                }),
              );
              console.warn(`Invalid message signature from user ${userId}`);
              return;
            }

            // Verify recipient is specified
            if (!encryptedMessage.recipientId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Recipient ID is required",
                }),
              );
              return;
            }

            // Deliver message to recipient
            const delivered = deliverMessage(encryptedMessage);

            ws.send(
              JSON.stringify({
                type: "message-ack",
                messageId: message.id,
                delivered,
              }),
            );
          }
        } catch (error) {
          console.error("WebSocket message handling error:", error);
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
