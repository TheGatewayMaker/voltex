import { Pool, PoolClient } from "pg";

/**
 * PostgreSQL connection pool
 * Manages database connections with connection pooling
 */
let pool: Pool | null = null;

/**
 * Initialize the database connection pool
 * Creates tables if they don't exist
 */
export async function initializeDatabase(): Promise<void> {
  if (pool) {
    console.log("Database pool already initialized");
    return;
  }

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.warn(
      "DATABASE_URL environment variable not set. Messages will use in-memory storage only.",
    );
    return;
  }

  try {
    pool = new Pool({
      connectionString,
      max: 10, // Maximum number of connections in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test the connection
    const client = await pool.connect();
    console.log("Successfully connected to PostgreSQL");
    client.release();

    // Initialize tables
    await createTables();
    console.log("Database tables initialized");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    pool = null;
    throw error;
  }
}

/**
 * Create necessary tables if they don't exist
 */
async function createTables(): Promise<void> {
  if (!pool) return;

  const createMessagesTable = `
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id VARCHAR(255) NOT NULL,
      recipient_id VARCHAR(255) NOT NULL,
      nonce VARCHAR(32) NOT NULL,
      ciphertext TEXT NOT NULL,
      signature VARCHAR(128) NOT NULL,
      timestamp BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      archived BOOLEAN DEFAULT FALSE,
      archived_at TIMESTAMP
    );

    -- Index for retrieving conversation messages
    CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(sender_id, recipient_id, timestamp DESC);

    -- Index for retrieving messages by timestamp (for archival)
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp_archived
    ON messages(timestamp, archived);

    -- Index for finding unarchived messages
    CREATE INDEX IF NOT EXISTS idx_messages_not_archived
    ON messages(archived, created_at DESC)
    WHERE archived = FALSE;

    -- Index for conversation queries
    CREATE INDEX IF NOT EXISTS idx_messages_bidirectional
    ON messages(
      (CASE WHEN sender_id < recipient_id THEN sender_id ELSE recipient_id END),
      (CASE WHEN sender_id < recipient_id THEN recipient_id ELSE sender_id END),
      timestamp DESC
    );
  `;

  const createConversationsTable = `
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      other_user_id VARCHAR(255) NOT NULL,
      last_message_timestamp BIGINT NOT NULL,
      last_message_preview VARCHAR(100),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- Unique constraint to prevent duplicate conversations
    CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_users
    ON conversations(
      (CASE WHEN user_id < other_user_id THEN user_id ELSE other_user_id END),
      (CASE WHEN user_id < other_user_id THEN other_user_id ELSE user_id END)
    );

    -- Index for quick lookup
    CREATE INDEX IF NOT EXISTS idx_conversations_user_id
    ON conversations(user_id, updated_at DESC);
  `;

  try {
    await pool.query(createMessagesTable);
    await pool.query(createConversationsTable);
    console.log("Tables created successfully");
  } catch (error) {
    console.error("Failed to create tables:", error);
    throw error;
  }
}

/**
 * Get a client from the pool
 */
export async function getPoolClient(): Promise<PoolClient | null> {
  if (!pool) return null;
  try {
    return await pool.connect();
  } catch (error) {
    console.error("Failed to get pool client:", error);
    return null;
  }
}

/**
 * Execute a query
 */
export async function query<T>(
  text: string,
  values?: unknown[],
): Promise<T[] | null> {
  if (!pool) return null;

  try {
    const result = await pool.query(text, values);
    return result.rows as T[];
  } catch (error) {
    console.error("Database query error:", error);
    throw error;
  }
}

/**
 * Execute a query and return first result
 */
export async function queryOne<T>(
  text: string,
  values?: unknown[],
): Promise<T | null> {
  const results = await query<T>(text, values);
  return results ? results[0] || null : null;
}

/**
 * Close the database connection pool
 */
export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.log("Database connection pool closed");
  }
}

/**
 * Check if database is connected
 */
export function isDatabaseConnected(): boolean {
  return pool !== null;
}

export default {
  initializeDatabase,
  query,
  queryOne,
  getPoolClient,
  closeDatabase,
  isDatabaseConnected,
};
