import { useState, useEffect, useRef } from "react";
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
import { EncryptedMessage, DecryptedMessage } from "@shared/crypto";
import { toast } from "sonner";

interface ChatMessage extends DecryptedMessage {
  id: string;
  isOwn: boolean;
  status?: "sent" | "delivered" | "failed"; // Track delivery status
}

export default function Chat() {
  const { id: recipientId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageInput, setMessageInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [recipientPublicKey, setRecipientPublicKey] = useState<string>("");
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [recipientName, setRecipientName] = useState<string>("");
  const sentMessagesRef = useRef<Map<string, string>>(new Map()); // Map messageId -> localMessageId

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
    });
  }, [recipientId, navigate]);

  // Load conversation history
  const loadConversation = async (userId: string, sessionToken: string) => {
    try {
      setIsLoading(true);

      // Get recipient's public key
      const pubKeyRes = await fetch(`/api/auth/public-key/${recipientId}`);
      if (!pubKeyRes.ok) {
        throw new Error("Failed to load recipient's public key");
      }
      const pubKeyData = await pubKeyRes.json();
      setRecipientPublicKey(pubKeyData.publicKey);
      setRecipientName(recipientId.substring(0, 8));

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
        throw new Error("Failed to load conversation history");
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
      for (const encMsg of historyData.messages) {
        try {
          // Determine sender's public key for decryption
          // NaCl box.open requires: the SENDER's public key and our PRIVATE key
          let senderPublicKey: string;

          if (encMsg.senderId === userId) {
            // This is our message - use our own public key
            senderPublicKey = currentUserPublicKey;
          } else {
            // This is from the other user - use recipient's public key
            senderPublicKey = pubKeyData.publicKey;
          }

          const decrypted = decryptMessage(
            encMsg,
            senderPublicKey,
            keyPair.privateKeyBase64,
          );

          if (decrypted) {
            decryptedMessages.push({
              ...decrypted,
              id: `${encMsg.timestamp}-${encMsg.senderId}`,
              isOwn: encMsg.senderId === userId,
            });
          } else {
            console.error(
              `Failed to decrypt message from ${encMsg.senderId}: wrong key or corrupted message`,
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
      setIsLoading(false);
    } catch (error) {
      console.error("Load conversation error:", error);
      toast.error("Failed to load conversation");
      setIsLoading(false);
    }
  };

  // Set up WebSocket for real-time messages
  const { isConnected, sendEncryptedMessage: sendViaWebSocket } = useWebSocket({
    onMessage: async (encryptedMessage) => {
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
          console.warn("Received own message from WebSocket");
          return;
        }

        // Get sender's public key for decryption
        // For messages from other user, use their public key
        const senderPublicKey = recipientPublicKey;

        if (!senderPublicKey) {
          console.error("No sender public key available for decryption");
          return;
        }

        const decrypted = decryptMessage(
          encryptedMessage,
          senderPublicKey,
          keyPair.privateKeyBase64,
        );

        if (decrypted) {
          const newMessage: ChatMessage = {
            ...decrypted,
            id: `${encryptedMessage.timestamp}-${encryptedMessage.senderId}`,
            isOwn: false, // Always false since we filtered out own messages
          };

          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === newMessage.id)) {
              return prev;
            }
            return [...prev, newMessage];
          });
        } else {
          console.error(
            `Failed to decrypt WebSocket message from ${encryptedMessage.senderId}`,
          );
        }
      } catch (error) {
        console.error("WebSocket message processing error:", error);
      }
    },
    onError: (error) => {
      console.error("WebSocket error:", error);
      toast.error("Connection error: " + error);
    },
    onConnected: () => {
      console.log("WebSocket connected for chat");
    },
  });

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
        throw new Error("No keys found on this device");
      }

      // Encrypt message
      const encrypted = encryptMessage(
        messageInput,
        recipientPublicKey,
        keyPair.privateKeyBase64,
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

      // Try to send via WebSocket if connected (real-time delivery)
      let sent = false;
      if (isConnected) {
        sent = sendViaWebSocket(fullMessage);
        if (sent) {
          console.log("Message sent via WebSocket");
        }
      }

      // If WebSocket not connected or failed, fall back to HTTP
      if (!sent) {
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
          throw new Error("Failed to send message");
        }
        console.log("Message sent via HTTP (fallback)");
      }

      // Add message to local state optimistically
      const newMessage: ChatMessage = {
        senderId: currentUserId,
        recipientId: recipientId || "",
        content: messageInput,
        timestamp: encrypted.timestamp,
        id: `${encrypted.timestamp}-${currentUserId}`,
        isOwn: true,
      };

      setMessages((prev) => [...prev, newMessage]);
      setMessageInput("");
    } catch (error) {
      console.error("Send message error:", error);
      toast.error("Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  // Helper to get user initials
  const getInitials = (userId: string) => {
    return userId.substring(0, 2).toUpperCase();
  };

  // Helper to format time
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
    }

    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
                }`}
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

                {/* Message Bubble */}
                <div
                  className={`max-w-xs md:max-w-md flex flex-col ${
                    message.isOwn ? "items-end" : "items-start"
                  }`}
                >
                  <div
                    className={`px-4 py-2 rounded-lg ${
                      message.isOwn
                        ? "bg-primary text-white rounded-br-none"
                        : "bg-secondary text-foreground rounded-bl-none"
                    }`}
                  >
                    <p className="break-words text-sm">{message.content}</p>
                  </div>
                  <span className="text-xs text-muted-foreground mt-1">
                    {formatTime(message.timestamp)}
                  </span>
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
            🔒 End-to-end encrypted • Only you and {recipientName} can read this
          </p>
        </div>
      </div>
    </Layout>
  );
}
