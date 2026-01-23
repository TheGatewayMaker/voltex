import { useState, useEffect } from "react";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Check, AlertCircle } from "lucide-react";
import Layout from "@/components/Layout";
import { toast } from "sonner";

interface UserProfile {
  userId: string;
  displayName?: string;
  publicKey?: string;
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
      const currentPublicKey = localStorage.getItem("current_public_key");

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
        publicKey: currentPublicKey || "",
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

  if (isLoading) {
    return (
      <Layout showProfileMenu={false}>
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
      <Layout showProfileMenu={false}>
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
      title="Account Settings"
      onBackClick={() => navigate("/")}
      showProfileMenu={false}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6 md:px-6 md:py-8">
          {/* Profile Header */}
          <div className="mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
              Account Information
            </h1>
            <p className="text-muted-foreground">
              View and manage your account details
            </p>
          </div>

          {/* User ID Section */}
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              User Identification
            </h2>

            <div className="space-y-4">
              {/* User ID */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  User ID
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={profile.userId}
                    readOnly
                    className="flex-1 px-3 py-2 bg-secondary border border-border text-foreground rounded-lg font-mono text-sm"
                  />
                  <button
                    onClick={() => copyToClipboard(profile.userId, "User ID")}
                    className="p-2 hover:bg-secondary rounded-lg transition-colors"
                  >
                    {copiedField === "User ID" ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Your unique identifier derived from your cryptographic public
                  key
                </p>
              </div>

              {/* Public Key */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Public Key
                </label>
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={profile.publicKey || ""}
                    readOnly
                    className="flex-1 px-3 py-2 bg-secondary border border-border text-foreground rounded-lg font-mono text-sm overflow-hidden text-ellipsis"
                  />
                  <button
                    onClick={() =>
                      copyToClipboard(profile.publicKey || "", "Public Key")
                    }
                    className="p-2 hover:bg-secondary rounded-lg transition-colors flex-shrink-0"
                  >
                    {copiedField === "Public Key" ? (
                      <Check className="w-5 h-5 text-green-500" />
                    ) : (
                      <Copy className="w-5 h-5" />
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Your public cryptographic key used for encryption
                </p>
              </div>
            </div>
          </div>

          {/* Profile Details Section */}
          <div className="bg-card border border-border rounded-lg p-6 mb-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">
              Profile Details
            </h2>

            <div className="space-y-4">
              {/* Display Name */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Enter your display name"
                  maxLength={50}
                  className="w-full px-4 py-2 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {displayName.length}/50 characters
                </p>
              </div>

              {/* Bio */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Bio
                </label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Tell others about yourself"
                  maxLength={200}
                  rows={4}
                  className="w-full px-4 py-2 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {bio.length}/200 characters
                </p>
              </div>

              {/* Account Created Date */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Account Created
                </label>
                <input
                  type="text"
                  value={
                    profile.createdAt
                      ? new Date(profile.createdAt).toLocaleDateString(
                          "en-US",
                          {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          },
                        )
                      : "Unknown"
                  }
                  readOnly
                  className="w-full px-4 py-2 bg-secondary border border-border text-foreground rounded-lg"
                />
              </div>
            </div>
          </div>

          {/* Security Notice */}
          <div className="bg-blue-500/10 border border-blue-500/50 rounded-lg p-4 mb-6">
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-blue-600 mb-1">
                  Security Information
                </p>
                <p className="text-xs text-blue-600/90">
                  Your cryptographic keys are stored securely on this device.
                  Your private key is never sent to our servers and is only used
                  to sign authentication challenges.
                </p>
              </div>
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSaveProfile}
            disabled={isSaving}
            className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <span className="flex items-center justify-center gap-2">
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
              </span>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>
    </Layout>
  );
}
