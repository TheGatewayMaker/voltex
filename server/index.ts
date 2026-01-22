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
  getSessionFromToken,
} from "./routes/auth";
import {
  handleSendMessage,
  handleGetConversation,
  handleGetConversations,
  handleDeleteConversation,
} from "./routes/messages";
import {
  registerUserConnection,
  unregisterUserConnection,
  deliverMessage,
  getQueuedMessages,
} from "./lib/messaging";
import { validateEncryptedMessage } from "./lib/crypto";

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
  app.post("/api/auth/logout", handleLogout);

  // Message routes
  app.post("/api/messages/send", handleSendMessage);
  app.get("/api/messages/conversation/:recipientId", handleGetConversation);
  app.get("/api/messages/conversations", handleGetConversations);
  app.delete(
    "/api/messages/conversation/:recipientId",
    handleDeleteConversation,
  );

  // Create WebSocket server if not already created
  if (!wssInstance) {
    wssInstance = new WebSocketServer({ noServer: true });

    wssInstance.on("connection", (ws, req) => {
      const token = req.url?.split("?token=")[1];

      if (!token) {
        ws.close();
        return;
      }

      const session = getSessionFromToken(token);
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

            // Verify sender matches authenticated user
            if (encryptedMessage.senderId !== userId) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  error: "Sender ID does not match authenticated user",
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
