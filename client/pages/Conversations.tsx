import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import Layout from "@/components/Layout";
import { Lock, Search, X, RefreshCw } from "lucide-react";
import { useWebSocket } from "@/lib/useWebSocket";
import { toast } from "sonner";

interface Conversation {
  id: string;
  name: string;
  username: string;
  avatar: string;
  lastMessage: string;
  timestamp: string;
  unread: number;
  online: boolean;
}

interface SearchResult {
  userId: string;
  username: string;
  displayName: string;
  bio: string;
  avatar: string | null;
}

export default function Conversations() {
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentDisplayName, setCurrentDisplayName] = useState("User");
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

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

    // Fetch user profile and conversation list
    fetchUserProfile(sessionToken);
    loadConversations(sessionToken);
  }, [navigate]);

  // Refresh conversations when navigating back to this page
  useEffect(() => {
    if (location.pathname === "/") {
      const sessionToken = localStorage.getItem("session_token");
      if (sessionToken) {
        loadConversations(sessionToken);
      }
    }
  }, [location]);

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

  const loadConversations = async (sessionToken: string) => {
    try {
      const response = await fetch("/api/messages/conversations", {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        // Convert server data to UI format with user profile info
        const conversationList: Conversation[] = [];

        for (const conv of data.conversations) {
          try {
            // Fetch user profile to get display name and username
            const profileRes = await fetch(`/api/profile/${conv.userId}`);
            let displayName = "User";
            let username = conv.userId.substring(0, 8);

            if (profileRes.ok) {
              const profileData = await profileRes.json();
              displayName = profileData.displayName || "User";
              username = profileData.username || conv.userId.substring(0, 8);
            }

            conversationList.push({
              id: conv.userId,
              name: displayName,
              username: username,
              avatar: displayName.charAt(0).toUpperCase(),
              lastMessage: conv.lastMessage || "(No messages)",
              timestamp: formatTimestamp(conv.timestamp),
              unread: 0,
              online: false,
            });
          } catch (error) {
            console.error(`Failed to load profile for ${conv.userId}:`, error);
            // Fallback to using user ID if profile fetch fails
            conversationList.push({
              id: conv.userId,
              name: "User",
              username: conv.userId.substring(0, 8),
              avatar: conv.userId.substring(0, 2).toUpperCase(),
              lastMessage: conv.lastMessage || "(No messages)",
              timestamp: formatTimestamp(conv.timestamp),
              unread: 0,
              online: false,
            });
          }
        }

        setConversations(conversationList);
      }
    } catch (error) {
      console.error("Failed to load conversations:", error);
    }
  };

  const formatTimestamp = (timestamp: number) => {
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

  const handleSearchUsers = async (query: string) => {
    setSearchQuery(query);

    if (!query.trim()) {
      setSearchResults([]);
      setSearchError("");
      return;
    }

    setIsSearching(true);
    setSearchError("");

    try {
      const response = await fetch("/api/users/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        setSearchResults(data.results);
      } else {
        const errorData = await response.json();
        setSearchError(errorData.error || "Search failed");
      }
    } catch (error) {
      console.error("Search error:", error);
      setSearchError("Failed to search users");
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectUser = (user: SearchResult) => {
    setShowSearchModal(false);
    setSearchQuery("");
    setSearchResults([]);
    // Navigate to chat with the selected user
    navigate(`/chat/${user.userId}`);
  };

  const handleRefreshConversations = async () => {
    const sessionToken = localStorage.getItem("session_token");
    if (sessionToken) {
      setIsRefreshing(true);
      try {
        await loadConversations(sessionToken);
        toast.success("Conversations refreshed");
      } finally {
        setIsRefreshing(false);
      }
    }
  };

  // WebSocket callbacks - memoized to prevent reconnection loops
  const handleWebSocketMessage = useCallback((_message: any) => {
    console.log("New message received");
    // Refresh conversations list when a new message arrives
    const sessionToken = localStorage.getItem("session_token");
    if (sessionToken) {
      loadConversations(sessionToken);
    }
    toast.success("New message received");
  }, []);

  const handleWebSocketConnected = useCallback(() => {
    console.log("WebSocket connected");
  }, []);

  const handleWebSocketDisconnected = useCallback(() => {
    console.log("WebSocket disconnected");
  }, []);

  // Set up WebSocket connection (optional feature)
  const { isConnected } = useWebSocket({
    onMessage: handleWebSocketMessage,
    onConnected: handleWebSocketConnected,
    onDisconnected: handleWebSocketDisconnected,
  });

  if (!isAuthenticated) {
    return null;
  }

  return (
    <Layout
      showProfileMenu={true}
      profileData={{
        userId: currentUserId,
        displayName: currentDisplayName,
      }}
      onSearchClick={() => setShowSearchModal(true)}
    >
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
            <button
              onClick={handleRefreshConversations}
              disabled={isRefreshing}
              className="p-2 hover:bg-secondary rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Refresh conversations"
            >
              <RefreshCw
                className={`w-5 h-5 text-muted-foreground ${
                  isRefreshing ? "animate-spin" : ""
                }`}
              />
            </button>
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-gray-500"
              }`}
            />
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
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground truncate text-sm md:text-base">
                        {conversation.name}
                      </h3>
                      <p className="text-xs text-muted-foreground truncate">
                        @{conversation.username}
                      </p>
                    </div>
                    <span className="text-xs md:text-sm text-muted-foreground flex-shrink-0">
                      {conversation.timestamp}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1">
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
          onClick={() => setShowSearchModal(true)}
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

        {/* Username Search Modal */}
        {showSearchModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-background rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
              {/* Modal Header */}
              <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
                <h2 className="text-lg font-semibold text-foreground">
                  Start New Chat
                </h2>
                <button
                  onClick={() => {
                    setShowSearchModal(false);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Search Input */}
              <div className="p-4 md:p-6 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    placeholder="Search by username..."
                    autoFocus
                    className="w-full pl-10 pr-4 py-2 bg-secondary text-foreground placeholder-muted-foreground rounded-full border border-border focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Enter a username to find users
                </p>
              </div>

              {/* Search Results */}
              <div className="flex-1 overflow-y-auto">
                {searchError && (
                  <div className="p-4 md:p-6 text-sm text-destructive bg-destructive/10">
                    {searchError}
                  </div>
                )}

                {isSearching && (
                  <div className="flex items-center justify-center h-32">
                    <svg
                      className="animate-spin h-6 w-6 text-primary"
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
                  </div>
                )}

                {!isSearching && searchQuery && searchResults.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 p-4">
                    <p className="text-muted-foreground text-sm">
                      No users found for "{searchQuery}"
                    </p>
                  </div>
                )}

                {searchResults.map((user) => (
                  <button
                    key={user.userId}
                    onClick={() => handleSelectUser(user)}
                    className="w-full px-4 py-3 md:px-6 md:py-4 border-b border-border hover:bg-secondary transition-colors text-left flex items-center gap-3 active:bg-secondary"
                  >
                    {/* Avatar */}
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/80 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                        {user.avatar ||
                          user.displayName.charAt(0).toUpperCase()}
                      </div>
                    </div>

                    {/* User Info */}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-sm md:text-base truncate">
                        {user.displayName}
                      </h3>
                      <p className="text-xs md:text-sm text-muted-foreground truncate">
                        @{user.username}
                      </p>
                      {user.bio && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {user.bio}
                        </p>
                      )}
                    </div>
                  </button>
                ))}

                {!searchQuery && !isSearching && (
                  <div className="flex flex-col items-center justify-center h-32 p-4">
                    <Search className="w-8 h-8 text-muted-foreground mb-2" />
                    <p className="text-muted-foreground text-sm text-center">
                      Search for users by their username to start a conversation
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
