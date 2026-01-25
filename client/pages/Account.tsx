import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Check, AlertCircle, Eye, EyeOff, LogOut } from "lucide-react";
import Layout from "@/components/Layout";
import { toast } from "sonner";

interface UserProfile {
  userId: string;
  displayName?: string;
  bio?: string;
  avatar?: string;
  createdAt?: number;
}

export default function Account() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showUserId, setShowUserId] = useState(false);

  useEffect(() => {
    // Check if user is authenticated
    const sessionToken = localStorage.getItem("session_token");
    const currentUserId = localStorage.getItem("current_user_id");

    if (!sessionToken || !currentUserId) {
      navigate("/signin");
      return;
    }

    fetchProfile();
  }, [navigate]);

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      const sessionToken = localStorage.getItem("session_token");
      const currentUserId = localStorage.getItem("current_user_id");

      const response = await fetch("/api/profile/me", {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch profile");
      }

      const data = await response.json();

      setProfile({
        userId: currentUserId || "",
        ...data,
      });

      setDisplayName(data.displayName || "");
      setBio(data.bio || "");
    } catch (error) {
      console.error("Error fetching profile:", error);
      toast.error("Failed to load profile");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      setIsSaving(true);
      const sessionToken = localStorage.getItem("session_token");

      const response = await fetch("/api/profile/me", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({
          displayName: displayName || undefined,
          bio: bio || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to update profile");
      }

      const data = await response.json();
      setProfile(data.profile);
      toast.success("Profile updated successfully");
    } catch (error) {
      console.error("Error saving profile:", error);
      toast.error("Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      toast.success(`${field} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
      try {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopiedField(field);
        toast.success(`${field} copied to clipboard`);
        setTimeout(() => setCopiedField(null), 2000);
      } catch {
        toast.error("Failed to copy to clipboard");
      }
    }
  };

  const handleLogout = async () => {
    try {
      const sessionToken = localStorage.getItem("session_token");
      if (sessionToken) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });
      }
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      localStorage.clear();
      navigate("/signin");
    }
  };

  if (isLoading) {
    return (
      <Layout
        showProfileMenu={false}
        showBack={true}
        onBackClick={() => navigate("/")}
        title="Account"
      >
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <svg
              className="animate-spin h-8 w-8 mx-auto mb-4 text-primary"
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
            <p className="text-muted-foreground">Loading profile...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!profile) {
    return (
      <Layout
        showProfileMenu={false}
        showBack={true}
        onBackClick={() => navigate("/")}
        title="Account"
      >
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <p className="text-destructive">Failed to load profile</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      showBack={true}
      title="Account"
      onBackClick={() => navigate("/")}
      showProfileMenu={false}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
          {/* Profile Header */}
          <div className="mb-6 sm:mb-8">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2 break-words">
                  {displayName || "Your Account"}
                </h1>
                <p className="text-muted-foreground text-xs sm:text-sm">
                  Manage your profile and security settings
                </p>
              </div>
            </div>
          </div>

          {/* Profile Information Section */}
          <div className="bg-card border border-border rounded-lg sm:rounded-xl p-4 sm:p-6 mb-4 sm:mb-6">
            <h2 className="text-base sm:text-lg font-semibold text-foreground mb-3 sm:mb-5">
              Profile Information
            </h2>

            <div className="space-y-3 sm:space-y-5">
              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Add a display name"
                  maxLength={50}
                  className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {displayName.length}/50 characters
                </p>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  About
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell others about yourself"
                  maxLength={200}
                  rows={4}
                  className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none transition-all"
                />
                <p className="text-xs text-muted-foreground mt-1.5">
                  {bio.length}/200 characters
                </p>
              </div>

              {/* Account Created Date */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Account Created
                </label>
                <div className="px-4 py-3 bg-secondary border border-border text-foreground rounded-lg text-sm">
                  {profile.createdAt
                    ? new Date(profile.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })
                    : "Unknown"}
                </div>
              </div>
            </div>

            {/* Save Button */}
            <button
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="w-full mt-6 py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 50 50">
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
                  Saving...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>

          {/* Account Identification Section */}
          <div className="bg-card border border-border rounded-xl p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-5">
              Account Identification
            </h2>

            <div className="space-y-4">
              {/* User ID with Toggle */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  User ID
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type={showUserId ? "text" : "password"}
                    value={profile.userId}
                    readOnly
                    className="flex-1 px-4 py-3 bg-secondary border border-border text-foreground rounded-lg font-mono text-sm"
                  />
                  <button
                    onClick={() => setShowUserId(!showUserId)}
                    className="p-2 hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
                    title={showUserId ? "Hide ID" : "Show ID"}
                  >
                    {showUserId ? (
                      <EyeOff className="w-5 h-5 text-muted-foreground" />
                    ) : (
                      <Eye className="w-5 h-5 text-muted-foreground" />
                    )}
                  </button>
                  <button
                    onClick={() => copyToClipboard(profile.userId, "User ID")}
                    className="p-2 hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedField === "User ID" ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  Your unique account identifier
                </p>
              </div>
            </div>
          </div>

          {/* Security Notice */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 mb-6">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-600 mb-1">
                  End-to-End Encrypted
                </p>
                <p className="text-xs text-blue-600/90">
                  Your messages are encrypted on your device before being sent.
                  Only the recipient can decrypt them. We never have access to
                  your message content.
                </p>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="border-t border-border pt-6 mt-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Danger Zone
            </h2>
            <button
              onClick={handleLogout}
              className="w-full py-3 bg-destructive/10 text-destructive hover:bg-destructive/20 font-semibold rounded-lg transition-all border border-destructive/30 flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
