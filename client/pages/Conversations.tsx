import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Lock } from "lucide-react";
import { useWebSocket } from "@/lib/useWebSocket";
import { toast } from "sonner";

interface Conversation {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  online: boolean;
}

export default function Conversations() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentDisplayName, setCurrentDisplayName] = useState("User");

  // Check authentication status and fetch user profile
  useEffect(() => {
    const userId = localStorage.getItem("current_user_id");
    const sessionToken = localStorage.getItem("session_token");

    if (!userId || !sessionToken) {
      // Not authenticated, redirect to signin
      navigate("/signin");
      return;
    }

    setCurrentUserId(userId);
    setIsAuthenticated(true);

    // Fetch user profile
    fetchUserProfile(sessionToken);
  }, [navigate]);

  const fetchUserProfile = async (sessionToken: string) => {
    try {
      const response = await fetch("/api/profile/me", {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setCurrentDisplayName(data.displayName || "User");
      }
    } catch (error) {
      console.error("Failed to fetch profile:", error);
    }
  };

  // Set up WebSocket connection (optional feature)
  const { isConnected } = useWebSocket({
    onMessage: (message) => {
      console.log("Received message:", message);
      toast.success("New message received");
    },
    onConnected: () => {
      console.log("WebSocket connected");
    },
    onDisconnected: () => {
      console.log("WebSocket disconnected");
    },
  });

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Layout>
      <div className="flex flex-col h-full bg-background">
        {/* Header with User Info */}
        <div className="px-4 py-3 md:px-6 md:py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Messages</h2>
            <p className="text-xs text-muted-foreground">
              User ID: {currentUserId.substring(0, 8)}...
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-gray-500"
              }`}
            />
            <button
              onClick={() => setShowLogoutMenu(!showLogoutMenu)}
              className="p-2 hover:bg-secondary rounded-lg transition-colors relative"
            >
              <LogOut className="w-5 h-5 text-foreground" />

              {showLogoutMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-lg shadow-lg z-10">
                  <button
                    onClick={handleLogout}
                    className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-secondary rounded-lg transition-colors"
                  >
                    Logout
                  </button>
                </div>
              )}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="px-4 py-3 md:px-6 md:py-4 border-b border-border">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search conversations..."
              className="w-full pl-10 pr-4 py-2 bg-secondary text-foreground placeholder-muted-foreground rounded-full border-0 focus:ring-2 focus:ring-primary outline-none transition-all text-sm md:text-base"
            />
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {conversations.map((conversation) => (
            <Link
              key={conversation.id}
              to={`/chat/${conversation.id}`}
              className="block border-b border-border hover:bg-secondary transition-colors active:bg-secondary"
            >
              <div className="px-4 py-3 md:px-6 md:py-4 flex items-center gap-3 md:gap-4">
                {/* Avatar */}
                <div className="flex-shrink-0 relative">
                  <div className="w-12 h-12 md:w-14 md:h-14 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center text-white font-semibold text-sm md:text-base">
                    {conversation.avatar}
                  </div>
                  {conversation.online && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 md:w-4 md:h-4 bg-green-500 rounded-full border-2 border-white dark:border-card"></div>
                  )}
                </div>

                {/* Conversation Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <h3 className="font-semibold text-foreground truncate text-sm md:text-base">
                      {conversation.name}
                    </h3>
                    <span className="text-xs md:text-sm text-muted-foreground flex-shrink-0">
                      {conversation.timestamp}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-muted-foreground text-xs md:text-sm truncate">
                      {conversation.lastMessage}
                    </p>
                    {conversation.unread > 0 && (
                      <div className="flex-shrink-0 w-6 h-6 md:w-7 md:h-7 bg-primary text-white rounded-full flex items-center justify-center text-xs font-semibold">
                        {conversation.unread}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Empty State Hint */}
        {conversations.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center px-4">
            <div className="w-16 h-16 md:w-20 md:h-20 bg-secondary rounded-full flex items-center justify-center mb-4">
              <Lock className="w-8 h-8 md:w-10 md:h-10 text-muted-foreground" />
            </div>
            <h3 className="text-lg md:text-xl font-semibold text-foreground mb-2">
              No conversations yet
            </h3>
            <p className="text-muted-foreground text-sm md:text-base text-center max-w-sm">
              All your messages are end-to-end encrypted. Start a new
              conversation to begin chatting securely.
            </p>
          </div>
        )}

        {/* Floating Action Button */}
        <button
          onClick={() => {
            // TODO: Open modal to select user and start new conversation
            // For now, show a placeholder message
            toast.info("Feature coming soon: Start a new conversation");
          }}
          className="absolute bottom-6 right-6 w-14 h-14 md:w-16 md:h-16 bg-primary text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary/90 transition-all active:scale-95 md:bottom-8 md:right-8"
        >
          <svg
            className="w-6 h-6 md:w-7 md:h-7"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>
    </Layout>
  );
}
