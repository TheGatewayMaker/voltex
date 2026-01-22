import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@aws-sdk/util-stream-node";

// Initialize R2 client with Cloudflare credentials
function initializeR2Client() {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT_URL;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("Missing R2 credentials in environment variables");
  }

  return new S3Client({
    region: "auto",
    endpoint: endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
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
    const client = initializeR2Client();
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: data,
      ContentType: contentType,
    });

    await client.send(command);
    console.log(`Successfully uploaded ${key} to R2`);
  } catch (error) {
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
    if (error instanceof Error && error.name === 'NoSuchKey') {
      console.log(`Key ${key} not found in R2`);
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
    if (error instanceof Error && error.name === 'NoSuchKey') {
      return false;
    }
    console.error("Error checking file existence in R2:", error);
    return false;
  }
}

/**
 * Save user profile metadata to R2
 */
export async function saveUserProfile(userId: string, profileData: any): Promise<void> {
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
