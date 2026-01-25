import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Shield } from "lucide-react";
import Layout from "@/components/Layout";
import { toast } from "sonner";

interface UserSettings {
  notifications?: boolean;
  privacy?: string;
  showTimestamps?: boolean;
}

export default function Settings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<UserSettings>({
    notifications: true,
    privacy: "public",
    showTimestamps: true,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Check if user is authenticated
    const sessionToken = localStorage.getItem("session_token");

    if (!sessionToken) {
      navigate("/signin");
      return;
    }

    fetchSettings();
  }, [navigate]);

  const fetchSettings = async () => {
    try {
      setIsLoading(true);
      const sessionToken = localStorage.getItem("session_token");

      const response = await fetch("/api/profile/me", {
        headers: {
          Authorization: `Bearer ${sessionToken}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch settings");
      }

      const data = await response.json();
      setSettings({
        notifications: data.notifications ?? true,
        privacy: data.privacy ?? "public",
        showTimestamps: data.showTimestamps ?? true,
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      toast.error("Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      setIsSaving(true);
      const sessionToken = localStorage.getItem("session_token");

      const response = await fetch("/api/profile/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error("Failed to update settings");
      }

      toast.success("Settings saved successfully");
    } catch (error) {
      console.error("Error saving settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
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
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout
      showBack={true}
      title="Settings"
      onBackClick={() => navigate("/")}
      showProfileMenu={false}
    >
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-3 py-4 sm:px-4 sm:py-6 md:px-6 md:py-8">
          {/* Settings Header */}
          <div className="mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1 sm:mb-2">
              Settings
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Customize your Voltex experience
            </p>
          </div>

          {/* Notifications Section */}
          <div className="bg-card border border-border rounded-lg sm:rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex gap-2 sm:gap-3 min-w-0">
                <Bell className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-semibold text-foreground">
                    Notifications
                  </h2>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
                    Receive notifications for new messages
                  </p>
                </div>
              </div>

              <label className="flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.notifications ?? true}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      notifications: e.target.checked,
                    })
                  }
                  className="w-4 h-4 sm:w-5 sm:h-5 rounded"
                />
              </label>
            </div>
          </div>

          {/* Privacy Section */}
          <div className="bg-card border border-border rounded-lg p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex items-start gap-2 sm:gap-3 mb-3 sm:mb-4">
              <Shield className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0 mt-0.5" />
              <div className="min-w-0">
                <h2 className="text-base sm:text-lg font-semibold text-foreground">
                  Privacy
                </h2>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5 sm:mt-1">
                  Control who can see your profile
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:gap-3">
              {[
                {
                  value: "public",
                  label: "Public",
                  description: "Anyone can find and message you",
                },
                {
                  value: "friends",
                  label: "Friends Only",
                  description: "Only contacts can message you",
                },
                {
                  value: "private",
                  label: "Private",
                  description: "You must approve message requests",
                },
              ].map((option) => (
                <label
                  key={option.value}
                  className="flex items-start gap-2 sm:gap-3 p-2.5 sm:p-3 border border-border rounded-lg cursor-pointer hover:bg-secondary/50 transition-colors"
                >
                  <input
                    type="radio"
                    name="privacy"
                    value={option.value}
                    checked={settings.privacy === option.value}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        privacy: e.target.value,
                      })
                    }
                    className="w-4 h-4 mt-0.5 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-foreground">
                      {option.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <button
            onClick={handleSaveSettings}
            disabled={isSaving}
            className="w-full py-2.5 sm:py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
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
              "Save Settings"
            )}
          </button>
        </div>
      </div>
    </Layout>
  );
}
