import { WebSocket } from "ws";
import { EncryptedMessage, SessionData } from "@shared/crypto";
import { validateEncryptedMessage } from "./crypto";

/**
 * Map of userId -> WebSocket connection
 * Enables real-time message routing
 */
const userConnections = new Map<string, WebSocket>();

/**
 * Message queue for users not currently connected
 * Maps userId -> array of messages
 */
const messageQueues = new Map<string, EncryptedMessage[]>();

/**
 * Register a user's WebSocket connection
 */
export function registerUserConnection(userId: string, ws: WebSocket): void {
  userConnections.set(userId, ws);
  console.log(
    `[REGISTRY] User ${userId} registered WebSocket connection. Total connected users: ${userConnections.size}`,
  );

  // If user has queued messages, send them now
  const queuedMessages = messageQueues.get(userId) || [];
  if (queuedMessages.length > 0) {
    console.log(
      `[REGISTRY] Flushing ${queuedMessages.length} queued messages for ${userId}`,
    );
    queuedMessages.forEach((message) => {
      try {
        ws.send(
          JSON.stringify({
            type: "message",
            data: message,
          }),
        );
        console.log(
          `[REGISTRY] ✓ Delivered queued message from ${message.senderId}`,
        );
      } catch (error) {
        console.error(
          `[REGISTRY] ✗ Error sending queued message to ${userId}:`,
          error,
        );
      }
    });
    messageQueues.delete(userId);
  }
}

/**
 * Unregister a user's WebSocket connection
 */
export function unregisterUserConnection(userId: string): void {
  userConnections.delete(userId);
}

/**
 * Send an encrypted message to a user
 * If user is connected, send immediately
 * Otherwise, queue the message
 */
export function deliverMessage(message: EncryptedMessage): boolean {
  const recipientId = message.recipientId;
  const userWs = userConnections.get(recipientId);
  const isConnected = userWs && userWs.readyState === 1;

  console.log(
    `[DELIVERY] Attempting to deliver message from ${message.senderId} to ${recipientId}`,
  );
  console.log(
    `[DELIVERY] Recipient connection status: found=${!!userWs}, connected=${isConnected}`,
  );
  console.log(
    `[DELIVERY] Current connected users: ${getConnectedUserIds().join(", ") || "(none)"}`,
  );

  if (isConnected) {
    // WebSocket.OPEN
    try {
      userWs.send(
        JSON.stringify({
          type: "message",
          data: message,
        }),
      );
      console.log(
        `[DELIVERY] ✓ Message delivered in real-time to ${recipientId}`,
      );
      return true;
    } catch (error) {
      console.error(
        `[DELIVERY] ✗ Error sending message to ${recipientId}:`,
        error,
      );
      queueMessage(message);
      return false;
    }
  } else {
    // User not connected, queue message
    console.log(
      `[DELIVERY] ℹ User ${recipientId} not connected, queuing message`,
    );
    queueMessage(message);
    return false;
  }
}

/**
 * Queue a message for later delivery
 * Max 500 messages per user to prevent memory bloat
 */
export function queueMessage(message: EncryptedMessage): void {
  const recipientId = message.recipientId;
  if (!messageQueues.has(recipientId)) {
    messageQueues.set(recipientId, []);
  }

  const queue = messageQueues.get(recipientId)!;
  const MAX_QUEUE_SIZE = 500; // Reduced from 1000 for better memory management

  // Limit queue size to prevent memory issues
  if (queue.length < MAX_QUEUE_SIZE) {
    queue.push(message);
    console.log(
      `[QUEUE] Message queued for ${recipientId}. Queue size: ${queue.length}/${MAX_QUEUE_SIZE}`,
    );
  } else {
    // Drop oldest message and add new one (FIFO overflow)
    queue.shift();
    queue.push(message);
    console.warn(
      `[QUEUE] Message queue for ${recipientId} full (${MAX_QUEUE_SIZE}), dropped oldest message to make space`,
    );
  }
}

/**
 * Get queue statistics for monitoring
 */
export function getQueueStats(): {
  totalQueuedMessages: number;
  usersWithQueuedMessages: number;
} {
  let totalQueuedMessages = 0;
  for (const queue of messageQueues.values()) {
    totalQueuedMessages += queue.length;
  }

  return {
    totalQueuedMessages,
    usersWithQueuedMessages: messageQueues.size,
  };
}

/**
 * Get all queued messages for a user
 * Used for message syncing
 */
export function getQueuedMessages(userId: string): EncryptedMessage[] {
  const messages = messageQueues.get(userId) || [];
  messageQueues.delete(userId);
  return messages;
}

/**
 * Get number of connected users
 */
export function getConnectedUserCount(): number {
  return userConnections.size;
}

/**
 * Get connection status for a user
 */
export function isUserConnected(userId: string): boolean {
  const ws = userConnections.get(userId);
  return ws ? ws.readyState === 1 : false;
}

/**
 * Broadcast a message to all connected users
 * Used for notifications, user status updates, etc.
 */
export function broadcastToAll(message: any): void {
  userConnections.forEach((ws) => {
    if (ws.readyState === 1) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error("Error broadcasting message:", error);
      }
    }
  });
}

/**
 * Close all connections and clear state
 */
export function closeAllConnections(): void {
  userConnections.forEach((ws) => {
    if (ws.readyState === 1) {
      ws.close();
    }
  });
  userConnections.clear();
}

/**
 * Get all connected user IDs
 */
export function getConnectedUserIds(): string[] {
  return Array.from(userConnections.keys());
}
