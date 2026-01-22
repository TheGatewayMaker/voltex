import { useEffect, useRef, useState } from "react";
import { EncryptedMessage, DecryptedMessage } from "@shared/crypto";

interface UseWebSocketOptions {
  onMessage?: (message: DecryptedMessage) => void;
  onError?: (error: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

export function useWebSocket(options?: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  useEffect(() => {
    const sessionToken = localStorage.getItem("session_token");
    const userId = localStorage.getItem("current_user_id");

    if (!sessionToken || !userId) {
      return;
    }

    // Only connect once
    if (wsRef.current) {
      return;
    }

    const connectWebSocket = () => {
      try {
        setIsConnecting(true);

        // Determine WebSocket URL based on current location
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const wsUrl = `${protocol}//${window.location.host}/ws?token=${sessionToken}`;

        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log("WebSocket connected");
          setIsConnecting(false);
          setIsConnected(true);
          options?.onConnected?.();
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "message") {
              // Handle incoming encrypted message
              options?.onMessage?.(data.data);
            } else if (data.type === "message-ack") {
              // Handle message acknowledgment
              console.log("Message acknowledged:", data.messageId);
            } else if (data.type === "error") {
              console.error("WebSocket error:", data.error);
              options?.onError?.(data.error);
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
          }
        };

        ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          setIsConnecting(false);
          options?.onError?.("WebSocket connection failed");
        };

        ws.onclose = () => {
          console.log("WebSocket disconnected");
          setIsConnected(false);
          setIsConnecting(false);
          wsRef.current = null;
          options?.onDisconnected?.();

          // Attempt to reconnect after 3 seconds
          setTimeout(connectWebSocket, 3000);
        };

        wsRef.current = ws;
      } catch (error) {
        console.error("Error connecting to WebSocket:", error);
        setIsConnecting(false);
        options?.onError?.(
          "Failed to connect to WebSocket"
        );
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [options]);

  /**
   * Send an encrypted message through WebSocket
   */
  const sendEncryptedMessage = (
    message: EncryptedMessage,
    messageId?: string
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
        })
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
