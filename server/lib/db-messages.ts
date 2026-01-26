import { EncryptedMessage } from "@shared/crypto";
import {
  query,
  queryOne,
  isDatabaseConnected as checkDatabaseConnected,
} from "./db";

// Re-export for convenience
export const isDatabaseConnected = checkDatabaseConnected;

export interface StoredMessage extends EncryptedMessage {
  id?: string;
  created_at?: string;
  archived?: boolean;
  archived_at?: string | null;
}

/**
 * Store a message in PostgreSQL
 * Falls back to in-memory storage if PostgreSQL is not available
 */
export async function storeMessageInDB(
  messageId: string,
  senderId: string,
  recipientId: string,
  message: EncryptedMessage,
): Promise<boolean> {
  if (!checkDatabaseConnected()) {
    console.log("Database not connected, falling back to in-memory storage");
    return false;
  }

  try {
    const result = await query(
      `INSERT INTO messages (
        id, sender_id, recipient_id, nonce, ciphertext, signature, timestamp, archived
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO NOTHING
      RETURNING id;`,
      [
        messageId,
        senderId,
        recipientId,
        message.nonce,
        message.ciphertext,
        message.signature,
        message.timestamp,
        false,
      ],
    );

    if (result && result.length > 0) {
      console.log(`Message ${messageId} stored in PostgreSQL`);
      // Also update conversation
      await updateConversation(senderId, recipientId, message);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Failed to store message in PostgreSQL:", error);
    return false;
  }
}

/**
 * Retrieve conversation messages from PostgreSQL
 * Returns only non-archived messages (recent messages)
 */
export async function getConversationMessagesFromDB(
  userId1: string,
  userId2: string,
  limit: number = 50,
  offset: number = 0,
): Promise<StoredMessage[]> {
  if (!checkDatabaseConnected()) {
    return [];
  }

  try {
    // Query both directions of conversation
    const results = await query<StoredMessage>(
      `SELECT 
        id, sender_id, recipient_id, nonce, ciphertext, signature, timestamp, 
        created_at, archived, archived_at
      FROM messages
      WHERE archived = FALSE
        AND (
          (sender_id = $1 AND recipient_id = $2) OR
          (sender_id = $2 AND recipient_id = $1)
        )
      ORDER BY timestamp DESC
      LIMIT $3 OFFSET $4;`,
      [userId1, userId2, limit, offset],
    );

    return results || [];
  } catch (error) {
    console.error("Failed to retrieve messages from PostgreSQL:", error);
    return [];
  }
}

/**
 * Get total count of messages in a conversation
 */
export async function getConversationMessageCount(
  userId1: string,
  userId2: string,
): Promise<number> {
  if (!checkDatabaseConnected()) {
    return 0;
  }

  try {
    const result = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count
      FROM messages
      WHERE archived = FALSE
        AND (
          (sender_id = $1 AND recipient_id = $2) OR
          (sender_id = $2 AND recipient_id = $1)
        );`,
      [userId1, userId2],
    );

    return result ? parseInt(result.count, 10) : 0;
  } catch (error) {
    console.error("Failed to get message count:", error);
    return 0;
  }
}

/**
 * Get conversations for a user (only non-archived messages)
 */
export async function getUserConversationsFromDB(
  userId: string,
): Promise<Map<string, { lastMessage: StoredMessage; timestamp: number }>> {
  if (!checkDatabaseConnected()) {
    return new Map();
  }

  try {
    const results = await query<any>(
      `WITH ranked_messages AS (
        SELECT
          CASE 
            WHEN sender_id = $1 THEN recipient_id 
            ELSE sender_id 
          END as other_user_id,
          nonce, ciphertext, signature, timestamp,
          ROW_NUMBER() OVER (
            PARTITION BY CASE 
              WHEN sender_id = $1 THEN recipient_id 
              ELSE sender_id 
            END
            ORDER BY timestamp DESC
          ) as rn
        FROM messages
        WHERE archived = FALSE
          AND (sender_id = $1 OR recipient_id = $1)
      )
      SELECT other_user_id, nonce, ciphertext, signature, timestamp
      FROM ranked_messages
      WHERE rn = 1
      ORDER BY timestamp DESC;`,
      [userId],
    );

    const conversations = new Map<
      string,
      { lastMessage: StoredMessage; timestamp: number }
    >();

    if (results) {
      for (const row of results) {
        conversations.set(row.other_user_id, {
          lastMessage: {
            nonce: row.nonce,
            ciphertext: row.ciphertext,
            signature: row.signature,
            senderId: "", // Will be populated from context
            recipientId: "",
            timestamp: row.timestamp,
          },
          timestamp: row.timestamp,
        });
      }
    }

    return conversations;
  } catch (error) {
    console.error("Failed to retrieve conversations from PostgreSQL:", error);
    return new Map();
  }
}

/**
 * Update conversation metadata
 */
async function updateConversation(
  senderId: string,
  recipientId: string,
  message: EncryptedMessage,
): Promise<void> {
  if (!checkDatabaseConnected()) {
    return;
  }

  try {
    const [user1, user2] = [senderId, recipientId].sort();

    await query(
      `INSERT INTO conversations (user_id, other_user_id, last_message_timestamp, last_message_preview)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id, other_user_id) DO UPDATE
      SET last_message_timestamp = $3,
          last_message_preview = $4,
          updated_at = CURRENT_TIMESTAMP;`,
      [user1, user2, message.timestamp, message.ciphertext.substring(0, 100)],
    );
  } catch (error) {
    console.error("Failed to update conversation:", error);
  }
}

/**
 * Update the last_read timestamp for a conversation
 */
export async function markConversationAsRead(
  userId: string,
  otherUserId: string,
): Promise<void> {
  if (!checkDatabaseConnected()) {
    return;
  }

  try {
    const [user1, user2] = [userId, otherUserId].sort();
    const now = Date.now();

    // CRITICAL FIX: Do NOT insert last_message_timestamp = 0 for new conversations
    // This was causing all conversations to show "Now" instead of actual timestamps
    // Instead, only update the last_read timestamp for existing conversations
    // The conversation will be created (if needed) when the first message is stored
    await query(
      `INSERT INTO conversations (user_id, other_user_id, last_read, updated_at)
      VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id, other_user_id) DO UPDATE
      SET last_read = $3,
          updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1 AND other_user_id = $2;`,
      [user1, user2, now],
    );
  } catch (error) {
    console.error("Failed to mark conversation as read:", error);
  }
}

/**
 * Get unread count for a conversation
 */
export async function getUnreadCount(
  userId: string,
  otherUserId: string,
): Promise<number> {
  if (!checkDatabaseConnected()) {
    return 0;
  }

  try {
    const [user1, user2] = [userId, otherUserId].sort();

    const result = await queryOne<{ count: number }>(
      `WITH conv_data AS (
        SELECT COALESCE(last_read, 0) as last_read_ts
        FROM conversations
        WHERE (user_id = $1 AND other_user_id = $2)
           OR (user_id = $2 AND other_user_id = $1)
        LIMIT 1
      )
      SELECT COUNT(*) as count
      FROM messages, conv_data
      WHERE archived = FALSE
        AND sender_id = $2
        AND recipient_id = $1
        AND timestamp > conv_data.last_read_ts;`,
      [user1, user2],
    );

    return result?.count || 0;
  } catch (error) {
    console.error("Failed to get unread count:", error);
    return 0;
  }
}

/**
 * Delete a specific message
 */
export async function deleteMessageFromDB(messageId: string): Promise<boolean> {
  if (!checkDatabaseConnected()) {
    return false;
  }

  try {
    const result = await query(
      `DELETE FROM messages WHERE id = $1 RETURNING id;`,
      [messageId],
    );

    return result && result.length > 0;
  } catch (error) {
    console.error("Failed to delete message from PostgreSQL:", error);
    return false;
  }
}

/**
 * Delete entire conversation
 */
export async function deleteConversationFromDB(
  userId1: string,
  userId2: string,
): Promise<boolean> {
  if (!checkDatabaseConnected()) {
    return false;
  }

  try {
    await query(
      `DELETE FROM messages
      WHERE (sender_id = $1 AND recipient_id = $2)
         OR (sender_id = $2 AND recipient_id = $1);`,
      [userId1, userId2],
    );

    return true;
  } catch (error) {
    console.error("Failed to delete conversation from PostgreSQL:", error);
    return false;
  }
}

/**
 * Get messages ready for archival (older than specified age)
 * Age is in milliseconds
 */
export async function getMessagesForArchival(
  ageMs: number,
  limit: number = 1000,
): Promise<StoredMessage[]> {
  if (!checkDatabaseConnected()) {
    return [];
  }

  try {
    const cutoffTime = Date.now() - ageMs;

    const results = await query<StoredMessage>(
      `SELECT 
        id, sender_id, recipient_id, nonce, ciphertext, signature, timestamp,
        created_at, archived, archived_at
      FROM messages
      WHERE archived = FALSE AND timestamp < $1
      ORDER BY timestamp ASC
      LIMIT $2;`,
      [cutoffTime, limit],
    );

    return results || [];
  } catch (error) {
    console.error("Failed to get messages for archival:", error);
    return [];
  }
}

/**
 * Mark messages as archived
 */
export async function markMessagesAsArchived(
  messageIds: string[],
): Promise<number> {
  if (!checkDatabaseConnected() || messageIds.length === 0) {
    return 0;
  }

  try {
    // Use parameterized query to safely insert array
    const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(",");

    const result = await query(
      `UPDATE messages 
      SET archived = TRUE, archived_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders})
      RETURNING id;`,
      messageIds,
    );

    const count = result ? result.length : 0;
    console.log(`Marked ${count} messages as archived`);
    return count;
  } catch (error) {
    console.error("Failed to mark messages as archived:", error);
    return 0;
  }
}

/**
 * Delete archived messages
 */
export async function deleteArchivedMessages(
  messageIds: string[],
): Promise<number> {
  if (!checkDatabaseConnected() || messageIds.length === 0) {
    return 0;
  }

  try {
    const placeholders = messageIds.map((_, i) => `$${i + 1}`).join(",");

    const result = await query(
      `DELETE FROM messages 
      WHERE id IN (${placeholders})
      RETURNING id;`,
      messageIds,
    );

    const count = result ? result.length : 0;
    console.log(`Deleted ${count} archived messages from PostgreSQL`);
    return count;
  } catch (error) {
    console.error("Failed to delete archived messages:", error);
    return 0;
  }
}

/**
 * Get database statistics
 */
export async function getDatabaseStats(): Promise<{
  total: number;
  archived: number;
  active: number;
}> {
  if (!checkDatabaseConnected()) {
    return { total: 0, archived: 0, active: 0 };
  }

  try {
    const result = await queryOne<{
      total: string;
      archived: string;
      active: string;
    }>(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN archived = TRUE THEN 1 ELSE 0 END) as archived,
        SUM(CASE WHEN archived = FALSE THEN 1 ELSE 0 END) as active
      FROM messages;`,
    );

    if (result) {
      return {
        total: parseInt(result.total, 10),
        archived: parseInt(result.archived || "0", 10),
        active: parseInt(result.active || "0", 10),
      };
    }

    return { total: 0, archived: 0, active: 0 };
  } catch (error) {
    console.error("Failed to get database stats:", error);
    return { total: 0, archived: 0, active: 0 };
  }
}
