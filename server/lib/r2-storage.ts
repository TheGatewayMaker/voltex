import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListBucketsCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@aws-sdk/util-stream-node";

// Global R2 client instance
let r2Client: S3Client | null = null;
const createdBuckets = new Set<string>();

// Initialize R2 client with Cloudflare credentials
function initializeR2Client(): S3Client {
  if (r2Client) {
    return r2Client;
  }

  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("Missing R2 credentials in environment variables");
  }

  r2Client = new S3Client({
    region: "auto",
    endpoint: endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return r2Client;
}

/**
 * Ensure a bucket exists, creating it if necessary
 */
async function ensureBucketExists(bucketName: string): Promise<void> {
  if (createdBuckets.has(bucketName)) {
    return; // Already checked/created in this session
  }

  try {
    const client = initializeR2Client();
    const createCommand = new CreateBucketCommand({
      Bucket: bucketName,
    });

    await client.send(createCommand);
    console.log(`Created bucket ${bucketName} in R2`);
    createdBuckets.add(bucketName);
  } catch (error) {
    const errorName = error instanceof Error ? (error as any).name : "";
    if (
      errorName === "BucketAlreadyExists" ||
      errorName === "BucketAlreadyOwnedByYou"
    ) {
      // Bucket already exists, that's fine
      createdBuckets.add(bucketName);
      return;
    }

    // Log but don't throw - the actual upload will fail with more details if needed
    console.log(
      `Bucket ${bucketName} may already exist or creation failed:`,
      error,
    );
    createdBuckets.add(bucketName); // Mark as attempted
  }
}

/**
 * Upload a file/data to R2 bucket
 */
export async function uploadToR2(
  bucketName: string,
  key: string,
  data: string | Buffer,
  contentType: string = "application/json",
): Promise<void> {
  try {
    // Ensure bucket exists before uploading
    await ensureBucketExists(bucketName);

    const client = initializeR2Client();

    // Try to upload with put object command
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: data,
      ContentType: contentType,
    });

    await client.send(command);
    console.log(`Successfully uploaded ${key} to R2`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // If bucket doesn't exist, provide helpful error message
    if (errorMessage.includes("NoSuchBucket")) {
      console.error(
        `Error: R2 bucket "${bucketName}" does not exist. Please create the following buckets in your Cloudflare R2 account: voltex-users, voltex-messages, voltex-recovery`,
      );
      throw new Error(
        `R2 bucket "${bucketName}" does not exist. Please create it in your Cloudflare R2 account.`,
      );
    }

    console.error("Error uploading to R2:", error);
    throw error;
  }
}

/**
 * Download data from R2 bucket
 */
export async function downloadFromR2(
  bucketName: string,
  key: string,
): Promise<string | null> {
  try {
    const client = initializeR2Client();
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await client.send(command);

    // Convert stream to string
    if (response.Body) {
      const bodyStream = sdkStreamMixin(response.Body);
      const data = await bodyStream.transformToString();
      return data;
    }

    return null;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      console.log(`Key ${key} not found in R2`);
      return null;
    }
    if (error instanceof Error && error.name === "NoSuchBucket") {
      console.log(`Bucket ${bucketName} not found in R2`);
      return null;
    }
    console.error("Error downloading from R2:", error);
    throw error;
  }
}

/**
 * Delete a file from R2 bucket
 */
export async function deleteFromR2(
  bucketName: string,
  key: string,
): Promise<void> {
  try {
    const client = initializeR2Client();
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await client.send(command);
    console.log(`Successfully deleted ${key} from R2`);
  } catch (error) {
    console.error("Error deleting from R2:", error);
    throw error;
  }
}

/**
 * Check if a file exists in R2
 */
export async function fileExistsInR2(
  bucketName: string,
  key: string,
): Promise<boolean> {
  try {
    const client = initializeR2Client();
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    await client.send(command);
    return true;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "NoSuchKey") {
      return false;
    }
    console.error("Error checking file existence in R2:", error);
    return false;
  }
}

/**
 * Save user profile metadata to R2
 */
export async function saveUserProfile(
  userId: string,
  profileData: any,
): Promise<void> {
  const bucketName = "voltex-users";
  const key = `profiles/${userId}.json`;
  const data = JSON.stringify({
    ...profileData,
    updatedAt: Date.now(),
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get user profile metadata from R2
 */
export async function getUserProfile(userId: string): Promise<any | null> {
  const bucketName = "voltex-users";
  const key = `profiles/${userId}.json`;

  const data = await downloadFromR2(bucketName, key);
  if (!data) return null;

  return JSON.parse(data);
}

/**
 * Save message to R2 (for archival/history)
 */
export async function saveMessage(
  messageId: string,
  messageData: any,
): Promise<void> {
  const bucketName = "voltex-messages";
  const key = `messages/${messageId}.json`;
  const data = JSON.stringify({
    ...messageData,
    savedAt: Date.now(),
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get message from R2
 */
export async function getMessage(messageId: string): Promise<any | null> {
  const bucketName = "voltex-messages";
  const key = `messages/${messageId}.json`;

  const data = await downloadFromR2(bucketName, key);
  if (!data) return null;

  return JSON.parse(data);
}

/**
 * Check if a username is available (not taken)
 */
export async function checkUsernameAvailability(
  username: string,
): Promise<boolean> {
  try {
    const bucketName = "voltex-users";
    const key = `usernames/${username.toLowerCase()}.json`;

    const exists = await fileExistsInR2(bucketName, key);
    return !exists; // Username is available if file doesn't exist
  } catch (error) {
    console.error("Error checking username availability:", error);
    return false; // If error, assume not available for safety
  }
}

/**
 * Reserve a username by storing a mapping to userId
 */
export async function reserveUsername(
  username: string,
  userId: string,
): Promise<void> {
  try {
    const bucketName = "voltex-users";
    const key = `usernames/${username.toLowerCase()}.json`;
    const data = JSON.stringify({
      username: username.toLowerCase(),
      userId,
      createdAt: Date.now(),
    });

    await uploadToR2(bucketName, key, data, "application/json");
  } catch (error) {
    console.error("Error reserving username:", error);
    throw error;
  }
}

/**
 * Get userId by username
 */
export async function getUserIdByUsername(
  username: string,
): Promise<string | null> {
  try {
    const bucketName = "voltex-users";
    const key = `usernames/${username.toLowerCase()}.json`;

    const data = await downloadFromR2(bucketName, key);
    if (!data) return null;

    const usernameData = JSON.parse(data);
    return usernameData.userId || null;
  } catch (error) {
    console.error("Error getting userId by username:", error);
    return null;
  }
}

/**
 * Save user account to R2
 */
export async function saveUserAccount(
  userId: string,
  accountData: any,
): Promise<void> {
  const bucketName = "voltex-users";
  const key = `accounts/${userId}.json`;
  const data = JSON.stringify({
    ...accountData,
    updatedAt: Date.now(),
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get user account from R2
 */
export async function getUserAccount(userId: string): Promise<any | null> {
  const bucketName = "voltex-users";
  const key = `accounts/${userId}.json`;

  const data = await downloadFromR2(bucketName, key);
  if (!data) return null;

  return JSON.parse(data);
}

/**
 * Store passphrase recovery data (hashed)
 */
export async function savePassphraseRecovery(
  userId: string,
  passphraseHash: string,
): Promise<void> {
  const bucketName = "voltex-recovery";
  const key = `${userId}/passphrase.json`;
  const data = JSON.stringify({
    userId,
    passphraseHash,
    createdAt: Date.now(),
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get passphrase recovery data
 */
export async function getPassphraseRecovery(
  userId: string,
): Promise<any | null> {
  const bucketName = "voltex-recovery";
  const key = `${userId}/passphrase.json`;

  const data = await downloadFromR2(bucketName, key);
  if (!data) return null;

  return JSON.parse(data);
}

/**
 * Save message with full metadata to R2
 */
export async function saveMessageWithMetadata(
  messageId: string,
  senderId: string,
  recipientId: string,
  messageData: any,
): Promise<void> {
  const bucketName = "voltex-messages";
  const conversationKey = [senderId, recipientId].sort().join(":");
  const key = `conversations/${conversationKey}/${messageId}.json`;

  const data = JSON.stringify({
    messageId,
    senderId,
    recipientId,
    createdAt: Date.now(),
    ...messageData,
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get conversation messages from R2
 */
export async function getConversationMessages(
  userId1: string,
  userId2: string,
  limit: number = 50,
  offset: number = 0,
): Promise<any[]> {
  const bucketName = "voltex-messages";
  const conversationKey = [userId1, userId2].sort().join(":");
  const prefix = `conversations/${conversationKey}/`;

  try {
    const client = initializeR2Client();
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    });

    const response = await client.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      return [];
    }

    // Sort by key (messageId timestamp) in reverse order (newest first)
    const sortedContents = response.Contents.sort((a, b) => {
      const aKey = a.Key || "";
      const bKey = b.Key || "";
      return bKey.localeCompare(aKey);
    });

    // Apply pagination
    const paginatedContents = sortedContents.slice(offset, offset + limit);

    // Fetch each message
    const messages: any[] = [];
    for (const content of paginatedContents) {
      if (!content.Key) continue;

      try {
        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: content.Key,
        });

        const getResponse = await client.send(getCommand);

        if (getResponse.Body) {
          const bodyStream = sdkStreamMixin(getResponse.Body);
          const data = await bodyStream.transformToString();
          const messageData = JSON.parse(data);

          // Extract just the encrypted message fields
          messages.push({
            nonce: messageData.nonce,
            ciphertext: messageData.ciphertext,
            signature: messageData.signature,
            senderId: messageData.senderId,
            recipientId: messageData.recipientId,
            timestamp: messageData.timestamp,
          });
        }
      } catch (error) {
        console.error(`Error retrieving message from ${content.Key}:`, error);
        // Continue with next message on error
      }
    }

    return messages;
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchBucket") {
      console.log(
        `Bucket ${bucketName} not found - messages not persisted yet`,
      );
      return [];
    }
    console.error("Error getting conversation messages from R2:", error);
    return [];
  }
}

/**
 * Get all conversations for a user from R2
 * Lists all conversation folders and returns the last message from each
 */
export async function getUserConversationsFromR2(
  userId: string,
): Promise<Map<string, { lastMessage: any; timestamp: number }>> {
  const bucketName = "voltex-messages";
  const prefix = "conversations/";
  const conversations = new Map<
    string,
    { lastMessage: any; timestamp: number }
  >();

  try {
    const client = initializeR2Client();
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    });

    const response = await client.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      return conversations;
    }

    // Find all conversation folders that include this user
    const conversationFolders = new Set<string>();
    for (const content of response.Contents) {
      if (!content.Key) continue;
      // Key format: conversations/{userId1}:{userId2}/{messageId}.json
      const match = content.Key.match(/conversations\/([^/]+)\//);
      if (match) {
        const conversationKey = match[1];
        const [user1, user2] = conversationKey.split(":");
        if (user1 === userId || user2 === userId) {
          conversationFolders.add(conversationKey);
        }
      }
    }

    // For each conversation, get the last message
    for (const conversationKey of conversationFolders) {
      try {
        const [user1, user2] = conversationKey.split(":");
        const otherUserId = user1 === userId ? user2 : user1;

        // List messages in this conversation
        const listCommand = new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: `conversations/${conversationKey}/`,
        });

        const listResponse = await client.send(listCommand);
        if (!listResponse.Contents || listResponse.Contents.length === 0) {
          continue;
        }

        // Get the last message (most recent by name sorting)
        const sortedContents = listResponse.Contents.sort((a, b) => {
          const aKey = a.Key || "";
          const bKey = b.Key || "";
          return bKey.localeCompare(aKey);
        });

        const lastMessageKey = sortedContents[0].Key;
        if (!lastMessageKey) continue;

        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: lastMessageKey,
        });

        const getResponse = await client.send(getCommand);
        if (getResponse.Body) {
          const bodyStream = sdkStreamMixin(getResponse.Body);
          const data = await bodyStream.transformToString();
          const messageData = JSON.parse(data);

          conversations.set(otherUserId, {
            lastMessage: messageData,
            timestamp: messageData.timestamp,
          });
        }
      } catch (error) {
        console.error(
          `Error retrieving conversation ${conversationKey} from R2:`,
          error,
        );
        // Continue with next conversation
      }
    }

    return conversations;
  } catch (error) {
    if (error instanceof Error && error.name === "NoSuchBucket") {
      console.log(
        `Bucket ${bucketName} not found - conversations not persisted yet`,
      );
      return conversations;
    }
    console.error("Error getting conversations from R2:", error);
    return conversations;
  }
}

/**
 * Save encrypted keypair to R2 for cross-device recovery
 * Server stores ciphertext only (client encrypts/decrypts)
 */
export async function saveEncryptedKeypair(
  userId: string,
  encryptedData: string,
  salt: string,
  iv: string,
): Promise<void> {
  const bucketName = "voltex-recovery";
  const key = `${userId}/keypair.json`;
  const data = JSON.stringify({
    userId,
    encryptedData,
    salt,
    iv,
    createdAt: Date.now(),
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get encrypted keypair from R2
 * Server returns ciphertext only (client decrypts locally)
 */
export async function getEncryptedKeypair(
  userId: string,
): Promise<{ encryptedData: string; salt: string; iv: string } | null> {
  const bucketName = "voltex-recovery";
  const key = `${userId}/keypair.json`;

  const data = await downloadFromR2(bucketName, key);
  if (!data) return null;

  const parsed = JSON.parse(data);
  return {
    encryptedData: parsed.encryptedData,
    salt: parsed.salt,
    iv: parsed.iv,
  };
}

/**
 * Save session to R2 for persistence across server restarts
 */
export async function saveSession(
  sessionToken: string,
  sessionData: any,
): Promise<void> {
  const bucketName = "voltex-users";
  const key = `sessions/${sessionToken}.json`;
  const data = JSON.stringify({
    ...sessionData,
    createdAt: Date.now(),
  });

  await uploadToR2(bucketName, key, data, "application/json");
}

/**
 * Get session from R2
 */
export async function getSessionData(
  sessionToken: string,
): Promise<any | null> {
  const bucketName = "voltex-users";
  const key = `sessions/${sessionToken}.json`;

  const data = await downloadFromR2(bucketName, key);
  if (!data) return null;

  return JSON.parse(data);
}

/**
 * Delete session from R2
 */
export async function deleteSessionData(sessionToken: string): Promise<void> {
  const bucketName = "voltex-users";
  const key = `sessions/${sessionToken}.json`;

  await deleteFromR2(bucketName, key);
}

/**
 * Save a batch of messages to R2 archive
 * Messages are grouped by conversation
 */
export async function saveMessageArchiveToR2(
  archiveKey: string,
  messages: any[],
): Promise<void> {
  const bucketName = "voltex-messages";
  const data = JSON.stringify({
    messages,
    archivedAt: Date.now(),
    messageCount: messages.length,
  });

  await uploadToR2(bucketName, archiveKey, data, "application/json");
}

/**
 * Delete archived messages from R2
 * This is called after messages have been deleted from PostgreSQL
 */
export async function deleteArchivedMessagesFromR2(
  archiveKey: string,
): Promise<void> {
  const bucketName = "voltex-messages";
  await deleteFromR2(bucketName, archiveKey);
}
