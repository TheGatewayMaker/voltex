import { useEffect, useRef, useState } from "react";
import { EncryptedMessage, DecryptedMessage } from "@shared/crypto";

interface UseWebSocketOptions {
  onMessage?: (message: DecryptedMessage) => void;
  onError?: (error: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onAck?: (messageId: string, delivered: boolean) => void; // Track delivery ACKs
}

export function useWebSocket(options?: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const optionsRef = useRef(options); // Keep a mutable reference to latest options
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update the ref whenever options change so handlers always call the latest callbacks
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const sessionToken = localStorage.getItem("session_token");
    const userId = localStorage.getItem("current_user_id");

    if (!sessionToken || !userId) {
      return;
    }

    // Only connect once per session
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // WebSocket already connected, update the callbacks
      return;
    }

    const connectWebSocket = () => {
      try {
        setIsConnecting(true);

        // Determine WebSocket URL based on current location
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${sessionToken}`;

        console.log(
          "[WS-CLIENT] Attempting WebSocket connection to:",
          wsUrl.replace(sessionToken, "TOKEN"),
        );
        console.log("[WS-CLIENT] Session token present:", !!sessionToken);
        console.log("[WS-CLIENT] User ID:", userId);

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("[WS-CLIENT] WebSocket connected successfully");
          console.log(
            "[WS-CLIENT] Session token:",
            sessionToken.substring(0, 20) + "...",
          );
          console.log("[WS-CLIENT] User ID:", userId);
          setIsConnecting(false);
          setIsConnected(true);
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts on successful connection
          optionsRef.current?.onConnected?.();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "message") {
              // Handle incoming encrypted message
              optionsRef.current?.onMessage?.(data.data);
            } else if (data.type === "message-ack") {
              // Handle message acknowledgment - track delivery
              const delivered = data.delivered !== false;
              console.log(
                `Message ${data.messageId} acknowledged (delivered: ${delivered})`,
              );
              optionsRef.current?.onAck?.(data.messageId, delivered);
            } else if (data.type === "error") {
              console.error("WebSocket error:", data.error);
              optionsRef.current?.onError?.(data.error);
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
          }
        };

        ws.onerror = (error) => {
          console.warn("[WS-CLIENT] WebSocket connection error:", error);
          setIsConnecting(false);
          // Attempt to reconnect
          scheduleReconnect();
        };

        ws.onclose = () => {
          console.log(
            "[WS-CLIENT] WebSocket disconnected (code:",
            (ws as any).code,
            "reason:",
            (ws as any).reason,
            ")",
          );
          setIsConnected(false);
          setIsConnecting(false);
          wsRef.current = null;
          optionsRef.current?.onDisconnected?.();

          // Attempt to reconnect with exponential backoff
          scheduleReconnect();
        };

        wsRef.current = ws;
      } catch (error) {
        console.error("Error connecting to WebSocket:", error);
        setIsConnecting(false);
        optionsRef.current?.onError?.("Failed to connect to WebSocket");
        scheduleReconnect();
      }
    };

    // Schedule reconnection with exponential backoff
    const scheduleReconnect = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      const maxAttempts = 10;
      if (reconnectAttemptsRef.current >= maxAttempts) {
        console.error("Max WebSocket reconnection attempts reached, giving up");
        return;
      }

      const baseDelay = 1000; // 1 second
      const maxDelay = 30000; // 30 seconds
      const delay = Math.min(
        baseDelay * Math.pow(2, reconnectAttemptsRef.current),
        maxDelay,
      );

      reconnectAttemptsRef.current += 1;
      console.log(
        `Scheduling WebSocket reconnect attempt ${reconnectAttemptsRef.current} in ${delay}ms`,
      );

      reconnectTimeoutRef.current = setTimeout(() => {
        console.log(
          `Attempting WebSocket reconnect (attempt ${reconnectAttemptsRef.current})`,
        );
        wsRef.current = null; // Clear the old reference
        connectWebSocket();
      }, delay);
    };

    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  /**
   * Send an encrypted message through WebSocket
   */
  const sendEncryptedMessage = (
    message: EncryptedMessage,
    messageId?: string,
  ) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not connected");
      return false;
    }

    try {
      wsRef.current.send(
        JSON.stringify({
          type: "message",
          id: messageId,
          data: message,
        }),
      );
      return true;
    } catch (error) {
      console.error("Error sending message:", error);
      return false;
    }
  };

  return {
    isConnected,
    isConnecting,
    sendEncryptedMessage,
  };
}

// Note: The options callbacks should be memoized with useCallback in the consuming component
// to prevent unnecessary WebSocket reconnections
