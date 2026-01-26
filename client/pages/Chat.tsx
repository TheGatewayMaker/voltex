import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Send } from "lucide-react";
import Layout from "@/components/Layout";
import { useWebSocket } from "@/lib/useWebSocket";
import {
  getStoredKeyPair,
  encryptMessage,
  decryptMessage,
  bytesToBase64,
} from "@/lib/crypto";
import { getServerTime } from "@/lib/serverTime";
import { EncryptedMessage, DecryptedMessage } from "@shared/crypto";
import { toast } from "sonner";

interface ChatMessage extends DecryptedMessage {
  id: string;
  isOwn: boolean;
  status?: "sent" | "delivered" | "failed"; // Track delivery status
  // Encrypted data stored for retry on reconnect
  nonce?: string;
  ciphertext?: string;
  signature?: string;
}

export default function Chat() {
  const { id: recipientId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pendingMessagesRef = useRef<ChatMessage[]>([]); // Queue for offline messages

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [recipientPublicKey, setRecipientPublicKey] = useState<string>("");
  const [recipientSignPublicKey, setRecipientSignPublicKey] =
    useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [recipientName, setRecipientName] = useState<string>("");
  const sentMessagesRef = useRef<Map<string, string>>(new Map()); // Map messageId -> localMessageId
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(
    null,
  );
  const [isDeletingMessageId, setIsDeletingMessageId] = useState<string | null>(
    null,
  );
  const [currentUserShowTimestamps, setCurrentUserShowTimestamps] =
    useState(true);
  const [recipientShowTimestamps, setRecipientShowTimestamps] = useState(true);
  const lastFetchTimestampRef = useRef<number>(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-scroll to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Verify session token is still valid
  const validateSession = async (sessionToken: string): Promise<boolean> => {
    try {
      const response = await fetch("/api/auth/verify-session", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });
      return response.ok;
    } catch (error) {
      console.error("Session validation error:", error);
      return false;
    }
  };

  // Verify authentication and get user info
  useEffect(() => {
    const userId = localStorage.getItem("current_user_id");
    const sessionToken = localStorage.getItem("session_token");

    if (!userId || !sessionToken || !recipientId) {
      navigate("/signin");
      return;
    }

    // Validate session is still active
    validateSession(sessionToken).then((isValid) => {
      if (!isValid) {
        toast.error("Session expired - please sign in again");
        localStorage.clear();
        navigate("/signin");
        return;
      }

      setCurrentUserId(userId);
      loadConversation(userId, sessionToken);
      // Mark conversation as read
      markConversationAsRead(sessionToken, recipientId);
    });
  }, [recipientId, navigate]);

  // Mark conversation as read
  const markConversationAsRead = async (
    sessionToken: string,
    otherUserId: string,
  ) => {
    try {
      await fetch(`/api/messages/conversations/${otherUserId}/read`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });
      console.log(`Conversation with ${otherUserId} marked as read`);
    } catch (error) {
      console.error("Failed to mark conversation as read:", error);
      // Don't show error to user as this is non-critical
    }
  };

  // Load conversation history
  const loadConversation = async (userId: string, sessionToken: string) => {
    try {
      setIsLoading(true);

      // Get recipient's public key
      const pubKeyRes = await fetch(`/api/auth/public-key/${recipientId}`);
      if (!pubKeyRes.ok) {
        const error = await pubKeyRes.json();
        throw new Error(error.error || "Failed to load recipient's public key");
      }
      const pubKeyData = await pubKeyRes.json();
      setRecipientPublicKey(pubKeyData.publicKey);
      setRecipientSignPublicKey(
        pubKeyData.signPublicKey || pubKeyData.publicKey,
      );

      // Get recipient's display name, username, and settings
      try {
        const profileRes = await fetch(`/api/profile/${recipientId}`);
        if (profileRes.ok) {
          const profileData = await profileRes.json();
          setRecipientName(profileData.displayName || "User");
          setRecipientShowTimestamps(profileData.showTimestamps ?? true);
        } else {
          setRecipientName("User");
        }
      } catch {
        setRecipientName("User");
      }

      // Get current user's settings
      try {
        const meRes = await fetch("/api/profile/me", {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          setCurrentUserShowTimestamps(meData.showTimestamps ?? true);
        }
      } catch {
        // Use default
      }

      // Get conversation history
      const historyRes = await fetch(
        `/api/messages/conversation/${recipientId}?limit=50`,
        {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        },
      );

      if (!historyRes.ok) {
        const error = await historyRes.json();
        throw new Error(error.error || "Failed to load conversation history");
      }

      const historyData = await historyRes.json();
      const keyPair = getStoredKeyPair();

      if (!keyPair) {
        throw new Error("No keys found on this device");
      }

      // Get current user's public key for when we sent messages
      const currentUserPublicKey = localStorage.getItem("current_public_key");
      if (!currentUserPublicKey) {
        throw new Error("No public key found for current user");
      }

      // Decrypt messages
      const decryptedMessages: ChatMessage[] = [];
      const currentSignPublicKey = localStorage.getItem(
        "current_sign_public_key",
      );
      const messageIds = new Set<string>(); // Track unique messages to prevent duplicates

      for (const encMsg of historyData.messages) {
        try {
          // Create unique message ID for deduplication
          const messageId = `${encMsg.timestamp}-${encMsg.senderId}`;

          // Skip if we already have this message (shouldn't happen, but safety check)
          if (messageIds.has(messageId)) {
            console.log(`Load: Skipping duplicate message ${messageId}`);
            continue;
          }

          // Determine public keys for decryption and signature verification
          // For NaCl box.open: we use the OTHER person's box public key + our PRIVATE key
          // This works for both our messages (we encrypted with their public key)
          // and their messages (they encrypted with our public key, but we use their public key to decrypt)
          const senderBoxPublicKey = pubKeyData.publicKey;
          let senderSignPublicKey: string | undefined;

          if (encMsg.senderId === userId) {
            // This is OUR message - use our own sign public key for signature verification
            senderSignPublicKey = currentSignPublicKey;
            if (!senderSignPublicKey) {
              console.warn(
                `Cannot decrypt own message - current_sign_public_key not found in localStorage`,
              );
              continue; // Skip this message
            }
          } else {
            // This is from the other user - use their sign public key
            senderSignPublicKey = pubKeyData.signPublicKey;
            if (!senderSignPublicKey) {
              console.warn(
                `Cannot decrypt message from ${encMsg.senderId} - recipient sign public key not available`,
              );
              continue; // Skip this message
            }
          }

          const decrypted = decryptMessage(
            encMsg,
            senderBoxPublicKey,
            keyPair.privateKeyBase64,
            senderSignPublicKey,
          );

          if (decrypted) {
            decryptedMessages.push({
              ...decrypted,
              id: messageId,
              isOwn: encMsg.senderId === userId,
            });
            messageIds.add(messageId);
          } else {
            console.error(
              `Failed to decrypt message from ${encMsg.senderId}: signature verification or decryption failed`,
            );
            toast.error(
              `Could not decrypt message from ${encMsg.senderId.substring(0, 8)}`,
            );
          }
        } catch (error) {
          console.error("Decryption error:", error);
          toast.error("Decryption error - message corrupted?");
        }
      }

      setMessages(decryptedMessages);

      // Track the last timestamp we've loaded
      if (decryptedMessages.length > 0) {
        const maxTimestamp = Math.max(
          ...decryptedMessages.map((m) => m.timestamp),
        );
        lastFetchTimestampRef.current = maxTimestamp;
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Load conversation error:", error);
      toast.error("Failed to load conversation");
      setIsLoading(false);
    }
  };

  // Poll for new messages as a fallback to WebSocket
  const pollForNewMessages = useCallback(async () => {
    try {
      const sessionToken = localStorage.getItem("session_token");
      if (!sessionToken || !recipientId || !currentUserId) return;

      const historyRes = await fetch(
        `/api/messages/conversation/${recipientId}?limit=100&offset=0`,
        {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        },
      );

      if (!historyRes.ok) return;

      const historyData = await historyRes.json();
      const keyPair = getStoredKeyPair();
      if (!keyPair) return;

      const currentSignPublicKey = localStorage.getItem(
        "current_sign_public_key",
      );

      // Process new messages
      for (const encMsg of historyData.messages) {
        // Skip messages we already have (using ref to track last timestamp)
        // Use both timestamp AND messageId for more robust deduplication
        if (encMsg.timestamp <= lastFetchTimestampRef.current) {
          console.log(
            `Polling: Skipping old message timestamp=${encMsg.timestamp} (last seen: ${lastFetchTimestampRef.current})`,
          );
          continue;
        }

        try {
          const senderBoxPublicKey =
            encMsg.senderId === currentUserId
              ? localStorage.getItem("current_public_key")
              : recipientPublicKey;

          const senderSignPublicKey =
            encMsg.senderId === currentUserId
              ? currentSignPublicKey
              : recipientSignPublicKey;

          if (!senderBoxPublicKey || !senderSignPublicKey) {
            console.warn(
              `Polling: Missing keys for message from ${encMsg.senderId}`,
            );
            continue;
          }

          const decrypted = decryptMessage(
            encMsg,
            senderBoxPublicKey,
            keyPair.privateKeyBase64,
            senderSignPublicKey,
          );

          if (decrypted) {
            // Use senderId + timestamp for unique message ID
            const messageId = `${encMsg.timestamp}-${encMsg.senderId}`;
            const newMessage: ChatMessage = {
              ...decrypted,
              id: messageId,
              isOwn: encMsg.senderId === currentUserId,
            };

            // Add only if not already present (by message ID)
            setMessages((prev) => {
              const exists = prev.some((m) => m.id === messageId);
              if (exists) {
                console.log(`Polling: Skipping duplicate message ${messageId}`);
                return prev;
              }
              console.log(`Polling: Adding new message ${messageId}`);
              return [...prev, newMessage];
            });

            // Update ref to track the latest timestamp we've seen
            lastFetchTimestampRef.current = Math.max(
              lastFetchTimestampRef.current,
              encMsg.timestamp,
            );
          } else {
            console.error(
              `Polling: Failed to decrypt message from ${encMsg.senderId}`,
            );
          }
        } catch (error) {
          console.error("Polling: Error decrypting message:", error);
        }
      }
    } catch (error) {
      console.error("Polling error:", error);
    }
  }, [recipientId, currentUserId, recipientPublicKey, recipientSignPublicKey]);

  // WebSocket callbacks - memoized to prevent reconnection loops
  const handleWebSocketMessage = useCallback(
    async (encryptedMessage: EncryptedMessage) => {
      // Only process messages from this conversation
      if (
        encryptedMessage.senderId !== recipientId &&
        encryptedMessage.senderId !== currentUserId
      ) {
        return;
      }

      try {
        const keyPair = getStoredKeyPair();
        if (!keyPair) return;

        // Verify sender matches authenticated user (sender authentication)
        if (encryptedMessage.senderId === currentUserId) {
          // Our own message - should not come from WebSocket in normal flow
          // Skip to avoid duplicates
          return;
        }

        // Get sender's public keys for decryption
        // For messages from other user, use their box and sign public keys
        let senderBoxPublicKey = recipientPublicKey;
        let senderSignPublicKey = recipientSignPublicKey;

        // If public keys haven't been loaded yet, fetch them now
        // This handles the race condition where messages arrive before keys are fetched
        if (!senderBoxPublicKey && recipientId) {
          try {
            console.log(
              "Public keys not yet loaded, fetching for decryption...",
            );
            const pubKeyRes = await fetch(
              `/api/auth/public-key/${recipientId}`,
            );
            if (pubKeyRes.ok) {
              const pubKeyData = await pubKeyRes.json();
              senderBoxPublicKey = pubKeyData.publicKey;
              senderSignPublicKey =
                pubKeyData.signPublicKey || pubKeyData.publicKey;
              // Update state so future messages don't need to re-fetch
              setRecipientPublicKey(pubKeyData.publicKey);
              setRecipientSignPublicKey(
                pubKeyData.signPublicKey || pubKeyData.publicKey,
              );
              console.log("Successfully fetched public keys for decryption");
            }
          } catch (error) {
            console.error("Failed to fetch public keys for decryption:", error);
            return;
          }
        }

        if (!senderBoxPublicKey) {
          console.error("No sender box public key available for decryption");
          return;
        }

        if (!senderSignPublicKey) {
          console.error(
            "No sender sign public key available for signature verification",
          );
          return;
        }

        const decrypted = decryptMessage(
          encryptedMessage,
          senderBoxPublicKey,
          keyPair.privateKeyBase64,
          senderSignPublicKey,
        );

        if (decrypted) {
          // Use senderId + timestamp for unique message ID (consistent across sources)
          // This is crucial for deduplication across polling + WebSocket
          const messageId = `${encryptedMessage.timestamp}-${encryptedMessage.senderId}`;
          const newMessage: ChatMessage = {
            ...decrypted,
            id: messageId,
            isOwn: false, // Always false since we filtered out own messages
          };

          setMessages((prev) => {
            // Check for exact duplicate by message ID
            const isDuplicate = prev.some((m) => m.id === messageId);
            if (isDuplicate) {
              console.log(
                `Skipping duplicate message ${messageId} from WebSocket`,
              );
              return prev;
            }
            console.log(`Adding new message ${messageId} from WebSocket`);
            return [...prev, newMessage];
          });

          // Update last fetch timestamp to prevent polling from re-adding this message
          lastFetchTimestampRef.current = Math.max(
            lastFetchTimestampRef.current,
            encryptedMessage.timestamp,
          );
        } else {
          console.error(
            `Failed to decrypt WebSocket message from ${encryptedMessage.senderId}`,
          );
        }
      } catch (error) {
        console.error("WebSocket message processing error:", error);
      }
    },
    [recipientId, currentUserId, recipientPublicKey, recipientSignPublicKey],
  );

  const handleWebSocketAck = useCallback(
    (messageId: string, delivered: boolean) => {
      // Update message delivery status based on ACK
      const localMessageId = sentMessagesRef.current.get(messageId);
      if (localMessageId) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === localMessageId
              ? { ...msg, status: delivered ? "delivered" : "sent" }
              : msg,
          ),
        );
      }
    },
    [],
  );

  const handleWebSocketDeletion = useCallback(
    (messageId: string, deletedBy: string) => {
      console.log(
        `Received deletion notification for message ${messageId} deleted by ${deletedBy}`,
      );
      // Remove the message from local state
      setMessages((prev) => {
        const updated = prev.filter((m) => m.id !== messageId);
        if (updated.length < prev.length) {
          console.log(`Message ${messageId} removed from local state`);
          toast.info("A message was deleted by the sender");
        }
        return updated;
      });
      // Deselect if this message was selected
      if (selectedMessageId === messageId) {
        setSelectedMessageId(null);
      }
    },
    [selectedMessageId],
  );

  const handleWebSocketError = useCallback((error: string) => {
    console.error("WebSocket error:", error);
    toast.error("Connection error: " + error);
  }, []);

  const handleWebSocketConnected = useCallback(() => {
    console.log("WebSocket connected for chat");
    // Retry any pending messages that failed to send
    retryPendingMessages();
  }, []);

  // Set up WebSocket for real-time messages
  const { isConnected, sendEncryptedMessage: sendViaWebSocket } = useWebSocket({
    onMessage: handleWebSocketMessage,
    onAck: handleWebSocketAck,
    onMessageDeleted: handleWebSocketDeletion,
    onError: handleWebSocketError,
    onConnected: handleWebSocketConnected,
  });

  // Start polling for new messages as a fallback (every 2 seconds)
  useEffect(() => {
    if (!recipientId || !currentUserId) return;

    // Initial poll immediately
    pollForNewMessages();

    // Set up polling interval
    pollIntervalRef.current = setInterval(() => {
      pollForNewMessages();
    }, 2000); // Poll every 2 seconds for new messages

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [recipientId, currentUserId, pollForNewMessages]);

  // Retry pending messages (queued for offline delivery)
  const retryPendingMessages = async () => {
    if (pendingMessagesRef.current.length === 0) return;

    console.log(
      `Retrying ${pendingMessagesRef.current.length} pending messages`,
    );

    const pendingToRetry = [...pendingMessagesRef.current];
    pendingMessagesRef.current = []; // Clear the queue

    for (const message of pendingToRetry) {
      try {
        const sessionToken = localStorage.getItem("session_token");
        if (!sessionToken) {
          // Re-queue if no session
          pendingMessagesRef.current.push(message);
          continue;
        }

        // Validate we have encrypted data
        if (!message.nonce || !message.ciphertext || !message.signature) {
          console.warn(
            `Message ${message.id} missing encrypted data, skipping`,
          );
          continue;
        }

        // Retry sending the message with stored encrypted data
        const sendRes = await fetch("/api/messages/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            recipientId,
            nonce: message.nonce,
            ciphertext: message.ciphertext,
            signature: message.signature,
            timestamp: message.timestamp,
          }),
        });

        if (sendRes.ok) {
          const response = await sendRes.json();
          const serverTimestamp = response.timestamp; // Get server's authoritative timestamp
          const serverMessageId = `${serverTimestamp}-${currentUserId}`; // Use server timestamp for message ID

          // Update message with server timestamp and delivered status
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === message.id
                ? {
                    ...msg,
                    id: serverMessageId,
                    timestamp: serverTimestamp,
                    status: "delivered",
                  }
                : msg,
            ),
          );
          console.log(
            `Retried message ${message.id} successfully with server timestamp ${serverTimestamp}`,
          );
        } else {
          // Re-queue if still failed
          pendingMessagesRef.current.push(message);
          console.warn(`Failed to retry message ${message.id}`);
        }
      } catch (error) {
        // Re-queue if error occurred
        pendingMessagesRef.current.push(message);
        console.error(`Error retrying message ${message.id}:`, error);
      }
    }
  };

  // Send message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageInput.trim()) {
      return;
    }

    if (!recipientPublicKey || !currentUserId) {
      toast.error("Chat not fully loaded");
      return;
    }

    try {
      setIsSending(true);

      // Validate session before sending
      const sessionToken = localStorage.getItem("session_token");
      if (!sessionToken) {
        throw new Error("No active session");
      }

      const isSessionValid = await validateSession(sessionToken);
      if (!isSessionValid) {
        throw new Error("Session expired - please sign in again and try again");
      }

      const keyPair = getStoredKeyPair();
      if (!keyPair) {
        throw new Error(
          "Your encryption keys are missing. Please sign out and sign back in to restore them using your passphrase, or create a new account.",
        );
      }

      // Encrypt message
      const encrypted = encryptMessage(
        messageInput,
        recipientPublicKey,
        keyPair.privateKeyBase64,
        keyPair.signPrivateKeyBase64,
      );

      // Create full encrypted message with sender info
      const fullMessage = {
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        signature: encrypted.signature,
        senderId: currentUserId,
        recipientId: recipientId || "",
        timestamp: encrypted.timestamp,
      };

      // Create local message ID for tracking delivery
      const localMessageId = `${encrypted.timestamp}-${currentUserId}`;

      // Add message to local state optimistically with "sent" status
      // Note: timestamp will be updated with server's authoritative timestamp
      const newMessage: ChatMessage = {
        senderId: currentUserId,
        recipientId: recipientId || "",
        content: messageInput,
        timestamp: encrypted.timestamp, // Temporary client timestamp, will be replaced
        id: localMessageId,
        isOwn: true,
        status: "sent",
        // Store encrypted data for retry on reconnect
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        signature: encrypted.signature,
      };

      setMessages((prev) => [...prev, newMessage]);
      setMessageInput("");

      // Try to send via WebSocket if connected (real-time delivery)
      let sent = false;
      if (isConnected) {
        // Generate a temporary message ID for this WebSocket transmission
        const wsMessageId = `${encrypted.timestamp}-ws`;
        sentMessagesRef.current.set(wsMessageId, localMessageId);

        sent = sendViaWebSocket(fullMessage, wsMessageId);
        if (sent) {
          console.log("Message sent via WebSocket");
        } else {
          sentMessagesRef.current.delete(wsMessageId);
        }
      }

      // If WebSocket not connected or failed, fall back to HTTP
      if (!sent) {
        try {
          const sendRes = await fetch("/api/messages/send", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${sessionToken}`,
            },
            body: JSON.stringify({
              recipientId,
              nonce: encrypted.nonce,
              ciphertext: encrypted.ciphertext,
              signature: encrypted.signature,
              timestamp: encrypted.timestamp,
            }),
          });

          if (!sendRes.ok) {
            const errorData = await sendRes.json();
            throw new Error(errorData.error || "Failed to send message");
          }

          const response = await sendRes.json();
          const serverTimestamp = response.timestamp; // Get server's authoritative timestamp
          const serverMessageId = `${serverTimestamp}-${currentUserId}`; // Use server timestamp for message ID

          // Update message with server timestamp and delivered status
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === localMessageId
                ? {
                    ...msg,
                    id: serverMessageId, // Update ID to use server timestamp
                    timestamp: serverTimestamp, // Use server-provided timestamp
                    status: "delivered",
                  }
                : msg,
            ),
          );

          // Update the pending messages ref to use new message ID
          pendingMessagesRef.current = pendingMessagesRef.current.map((m) =>
            m.id === localMessageId
              ? { ...m, id: serverMessageId, timestamp: serverTimestamp }
              : m,
          );

          // Warn user if message wasn't persisted to R2 (but still delivered to memory)
          if (!response.persisted) {
            console.warn("Message sent but not persisted to R2");
            toast.warning(
              "Message sent but backup storage failed - may not be recoverable if server restarts",
            );
          }

          console.log("Message sent via HTTP (fallback)");
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error occurred";
          console.error("Failed to send message:", errorMessage);
          // Update message status to failed
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === localMessageId ? { ...msg, status: "failed" } : msg,
            ),
          );
          // Queue message for retry when connection is restored
          const failedMessage = messages.find((m) => m.id === localMessageId);
          if (failedMessage) {
            pendingMessagesRef.current.push(failedMessage);
            toast.error(`Message queued for retry: ${errorMessage}`);
          }
        }
      }
    } catch (error) {
      console.error("Send message error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      toast.error(errorMessage);
    } finally {
      setIsSending(false);
    }
  };

  // Helper to get user initials
  const getInitials = (userId: string) => {
    return userId.substring(0, 2).toUpperCase();
  };

  // Helper to format time with date and 12-hour format using server time
  const formatTime = (timestamp: number | undefined | null) => {
    // Validate timestamp
    if (!timestamp || typeof timestamp !== "number" || timestamp <= 0) {
      return "Invalid time";
    }

    const date = new Date(timestamp);

    // Check if date is valid
    if (isNaN(date.getTime())) {
      return "Invalid time";
    }

    // Use server time for "now" to be consistent with server-based timestamps
    const now = new Date(getServerTime());

    // Format time in 12-hour format with AM/PM
    const timeString = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true, // Explicitly use 12-hour format
    });

    // Check if message is from today (using server time for comparison)
    if (date.toDateString() === now.toDateString()) {
      return timeString; // Just show time for today (e.g., "2:34 PM")
    }

    // For past messages, show date and time together in compact format
    const dateString = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
    });

    return `${dateString} ${timeString}`; // e.g., "Jan 3 2:34 PM"
  };

  // Delete message handler
  const handleDeleteMessage = async (messageId: string) => {
    try {
      setIsDeletingMessageId(messageId);
      const sessionToken = localStorage.getItem("session_token");

      if (!sessionToken) {
        toast.error("Session expired");
        return;
      }

      const deleteRes = await fetch("/api/messages/message", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          messageId,
          recipientId,
        }),
      });

      if (!deleteRes.ok) {
        const errorData = await deleteRes.json();
        throw new Error(errorData.error || "Failed to delete message");
      }

      // Remove from local state
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      setSelectedMessageId(null);
      toast.success("Message deleted");
    } catch (error) {
      console.error("Delete message error:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to delete message: ${errorMessage}`);
    } finally {
      setIsDeletingMessageId(null);
    }
  };

  return (
    <Layout
      showBack={true}
      onBackClick={() => navigate("/")}
      showProfileMenu={false}
    >
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <div className="px-4 py-3 md:px-6 md:py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center text-white font-semibold text-sm">
              {getInitials(recipientId || "")}
            </div>
            <div>
              <h2 className="font-semibold text-foreground">{recipientName}</h2>
              <p className="text-xs text-muted-foreground font-mono">
                {recipientId}
              </p>
            </div>
          </div>

          {/* Connection status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-gray-500"
              }`}
            />
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {isConnected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        {/* Messages List */}
        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6 md:py-6 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <svg
                  className="animate-spin h-8 w-8 text-primary mx-auto mb-4"
                  viewBox="0 0 50 50"
                >
                  <circle
                    className="opacity-30"
                    cx="25"
                    cy="25"
                    r="20"
                    stroke="currentColor"
                    strokeWidth="5"
                    fill="none"
                  />
                  <circle
                    cx="25"
                    cy="25"
                    r="20"
                    stroke="currentColor"
                    strokeWidth="5"
                    fill="none"
                    strokeDasharray="100"
                    strokeDashoffset="75"
                  />
                </svg>
                <p className="text-muted-foreground text-sm">
                  Loading conversation...
                </p>
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="w-16 h-16 bg-secondary rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg
                    className="w-8 h-8 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                    />
                  </svg>
                </div>
                <p className="text-muted-foreground text-sm">
                  No messages yet. Start the conversation!
                </p>
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.isOwn ? "flex-row-reverse" : ""
                } group relative`}
              >
                {/* Avatar */}
                <div className="flex-shrink-0">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs ${
                      message.isOwn
                        ? "bg-gradient-to-br from-blue-500 to-blue-600"
                        : "bg-gradient-to-br from-primary to-primary/80"
                    }`}
                  >
                    {getInitials(
                      message.isOwn ? currentUserId : recipientId || "",
                    )}
                  </div>
                </div>

                {/* Message Bubble with Options */}
                <div
                  className={`max-w-xs md:max-w-md flex flex-col ${
                    message.isOwn ? "items-end" : "items-start"
                  } relative`}
                >
                  <div
                    className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${
                      message.isOwn
                        ? "bg-primary text-white rounded-br-none hover:bg-primary/80"
                        : "bg-secondary text-foreground rounded-bl-none hover:bg-secondary/80"
                    } ${selectedMessageId === message.id ? "ring-2 ring-yellow-500" : ""}`}
                    onClick={() =>
                      setSelectedMessageId(
                        selectedMessageId === message.id ? null : message.id,
                      )
                    }
                  >
                    <p className="break-words text-sm">{message.content}</p>
                  </div>

                  {/* Message Options Menu */}
                  {selectedMessageId === message.id && (
                    <div
                      className={`absolute ${
                        message.isOwn ? "right-0" : "left-0"
                      } top-full mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-max`}
                    >
                      {message.isOwn && (
                        <button
                          onClick={() => handleDeleteMessage(message.id)}
                          disabled={isDeletingMessageId === message.id}
                          className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10 transition-colors first:rounded-t-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {isDeletingMessageId === message.id ? (
                            <>
                              <svg
                                className="animate-spin h-4 w-4"
                                viewBox="0 0 50 50"
                              >
                                <circle
                                  className="opacity-30"
                                  cx="25"
                                  cy="25"
                                  r="20"
                                  stroke="currentColor"
                                  strokeWidth="5"
                                  fill="none"
                                />
                                <circle
                                  cx="25"
                                  cy="25"
                                  r="20"
                                  stroke="currentColor"
                                  strokeWidth="5"
                                  fill="none"
                                  strokeDasharray="100"
                                  strokeDashoffset="75"
                                />
                              </svg>
                              Deleting...
                            </>
                          ) : (
                            <>
                              <svg
                                className="h-4 w-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                              Delete permanently
                            </>
                          )}
                        </button>
                      )}
                      {!message.isOwn && (
                        <div className="px-4 py-2 text-xs text-muted-foreground">
                          Only sender can delete
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1 mt-1">
                    {/* Show timestamp only if sender has timestamps enabled */}
                    {message.isOwn && currentUserShowTimestamps && (
                      <span className="text-xs text-muted-foreground">
                        {formatTime(message.timestamp)}
                      </span>
                    )}
                    {!message.isOwn && recipientShowTimestamps && (
                      <span className="text-xs text-muted-foreground">
                        {formatTime(message.timestamp)}
                      </span>
                    )}
                    {message.isOwn && message.status && (
                      <span className="text-xs text-muted-foreground">
                        {message.status === "sent" && "✓"}
                        {message.status === "delivered" && "✓✓"}
                        {message.status === "failed" && "✗"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Message Input */}
        <div className="px-4 py-3 md:px-6 md:py-4 border-t border-border">
          <form onSubmit={handleSendMessage} className="flex gap-2">
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              placeholder="Type a message (encrypted)..."
              disabled={isSending || isLoading}
              className="flex-1 px-4 py-2 bg-secondary text-foreground placeholder-muted-foreground rounded-full border-0 focus:ring-2 focus:ring-primary outline-none transition-all text-sm disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isSending || isLoading || !messageInput.trim()}
              className="p-2 bg-primary text-white rounded-full hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSending ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 50 50">
                  <circle
                    className="opacity-30"
                    cx="25"
                    cy="25"
                    r="20"
                    stroke="currentColor"
                    strokeWidth="5"
                    fill="none"
                  />
                  <circle
                    cx="25"
                    cy="25"
                    r="20"
                    stroke="currentColor"
                    strokeWidth="5"
                    fill="none"
                    strokeDasharray="100"
                    strokeDashoffset="75"
                  />
                </svg>
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            Private conversation • Only you and {recipientName} can see this
          </p>
        </div>
      </div>
    </Layout>
  );
}
