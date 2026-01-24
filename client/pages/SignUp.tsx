import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Copy, Check } from "lucide-react";
import {
  generateKeyPair,
  generateMnemonicPhrase,
  deriveUserIdFromPublicKey,
  storeKeyPair,
  storeMnemonic,
  signChallenge,
} from "@/lib/crypto";
import {
  hashPassphrase,
  normalizePassphrase,
  generateSalt,
  deriveEncryptionKey,
  encryptKeypair,
} from "@/lib/passphrase";
import { toast } from "sonner";

type SignUpStep = "form" | "username" | "passphrase" | "completed";

export default function SignUp() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SignUpStep>("form");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [userId, setUserId] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [copiedPassphrase, setCopiedPassphrase] = useState(false);
  const [keyPair, setKeyPair] = useState<any>(null);
  const [mnemonicData, setMnemonicData] = useState<any>(null);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim()) {
      setError("Display name is required");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Generate key pair locally (non-blocking)
      const newKeyPair = generateKeyPair();

      // Generate mnemonic for recovery
      const newMnemonicData = generateMnemonicPhrase();

      // Store for next step
      setKeyPair(newKeyPair);
      setMnemonicData(newMnemonicData);

      // Move to username step
      setStep("username");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account creation failed");
      toast.error(
        err instanceof Error ? err.message : "Account creation failed",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const checkUsernameAvailability = async (usernameValue: string) => {
    if (!usernameValue.trim()) {
      setUsernameError("");
      return;
    }

    // Validate format
    if (usernameValue.length < 3) {
      setUsernameError("Username must be at least 3 characters");
      return;
    }

    if (usernameValue.length > 30) {
      setUsernameError("Username must be no more than 30 characters");
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(usernameValue)) {
      setUsernameError(
        "Username can only contain letters, numbers, and underscores",
      );
      return;
    }

    setIsCheckingUsername(true);
    try {
      const response = await fetch("/api/auth/username-availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: usernameValue }),
      });

      const data = await response.json();
      if (!data.available) {
        setUsernameError("The Username is not Available, Please try another");
      } else {
        setUsernameError("");
      }
    } catch (err) {
      setUsernameError("Failed to check username availability");
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const handleContinueWithUsername = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!username.trim()) {
      setUsernameError("Username is required");
      return;
    }

    if (usernameError) {
      setUsernameError("Please choose a different username");
      return;
    }

    if (!keyPair || !mnemonicData) {
      setError("Session expired, please start over");
      setStep("form");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Derive user ID from public key
      const derivedUserId = await deriveUserIdFromPublicKey(
        keyPair.publicKeyBase64,
      );

      // Hash the mnemonic passphrase for recovery
      // Normalize first to ensure consistency with recovery flow
      const normalizedPassphrase = normalizePassphrase(mnemonicData.mnemonic);
      const passphraseHashHex = await hashPassphrase(normalizedPassphrase);

      // Register account on server with username
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: keyPair.publicKeyBase64,
          signPublicKey: keyPair.signPublicKeyBase64,
          passphraseHash: passphraseHashHex,
          username: username.toLowerCase(),
        }),
      });

      if (!registerResponse.ok) {
        const errorData = await registerResponse.json();
        throw new Error(errorData.error || "Registration failed");
      }

      // Get challenge for authentication
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: derivedUserId,
          publicKey: keyPair.publicKeyBase64,
        }),
      });

      if (!challengeResponse.ok) {
        const errorData = await challengeResponse.json();
        throw new Error(errorData.error || "Failed to get challenge");
      }

      const { challenge } = await challengeResponse.json();

      // Sign challenge with private key
      const signature = signChallenge(challenge, keyPair.privateKeyBase64);

      // Verify challenge and get session token
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: derivedUserId,
          challenge,
          signature,
          publicKey: keyPair.publicKeyBase64,
        }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        throw new Error(errorData.error || "Authentication failed");
      }

      const { sessionToken: token } = await verifyResponse.json();

      // Encrypt keypair and save to R2 for cross-device recovery
      try {
        const salt = generateSalt();
        const encryptionKey = await deriveEncryptionKey(
          normalizedPassphrase,
          salt,
        );
        const { encryptedData, iv } = await encryptKeypair(
          keyPair,
          encryptionKey,
        );

        await fetch("/api/auth/save-encrypted-keypair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: derivedUserId,
            encryptedData,
            salt,
            iv,
          }),
        });
      } catch (err) {
        console.error("Failed to save encrypted keypair to R2:", err);
        // Continue even if R2 save fails, as keys are stored locally
      }

      // Store keys and session locally
      storeKeyPair(keyPair);
      storeMnemonic(mnemonicData.mnemonic);
      localStorage.setItem("session_token", token);
      localStorage.setItem("current_user_id", derivedUserId);
      localStorage.setItem("current_public_key", keyPair.publicKeyBase64);

      // Store signing public key
      if (keyPair.signPublicKeyBase64) {
        localStorage.setItem(
          "current_sign_public_key",
          keyPair.signPublicKeyBase64,
        );
      }

      // Save display name and username to profile
      if (displayName.trim()) {
        try {
          await fetch("/api/profile/me", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              displayName: displayName.trim(),
              username: username.toLowerCase(),
            }),
          });
        } catch (err) {
          console.error("Failed to save profile:", err);
        }
      }

      // Show passphrase screen before completing
      setMnemonic(mnemonicData.mnemonic);
      setUserId(derivedUserId);
      setSessionToken(token);
      setStep("passphrase");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account creation failed");
      toast.error(
        err instanceof Error ? err.message : "Account creation failed",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmPassphrase = () => {
    setStep("completed");
    toast.success("Account created successfully! You're now logged in.");
    navigate("/");
  };

  const copyPassphrase = async () => {
    try {
      await navigator.clipboard.writeText(mnemonic);
      setCopiedPassphrase(true);
      toast.success("Passphrase copied to clipboard");
      setTimeout(() => setCopiedPassphrase(false), 2000);
    } catch (err) {
      console.error("Failed to copy to clipboard:", err);
      // Fallback: create a text area and copy manually
      try {
        const textArea = document.createElement("textarea");
        textArea.value = mnemonic;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        setCopiedPassphrase(true);
        toast.success("Passphrase copied to clipboard");
        setTimeout(() => setCopiedPassphrase(false), 2000);
      } catch {
        toast.error("Failed to copy passphrase to clipboard");
      }
    }
  };

  // Step 1: Display Name Form
  if (step === "form") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Join Voltex
            </h1>
            <p className="text-muted-foreground text-center">
              Create your secure account with cryptographic protection
            </p>
          </div>

          {/* Sign Up Form */}
          <form onSubmit={handleCreateAccount} className="space-y-4 mb-6">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Display Name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setError("");
                }}
                placeholder="Your Name"
                required
                disabled={isLoading}
                className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-6"
            >
              {isLoading ? (
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
                  Creating Account...
                </span>
              ) : (
                "Create Account"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-8">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-muted-foreground text-sm">
              Already have an account?
            </span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          {/* Sign In Link */}
          <Link
            to="/signin"
            className="block w-full py-3 border-2 border-primary text-primary font-semibold rounded-lg hover:bg-primary/10 transition-all text-center"
          >
            Sign In
          </Link>

          {/* Security Note */}
          <div className="mt-12 p-4 bg-secondary border border-border rounded-lg">
            <div className="flex gap-3">
              <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  Your Privacy
                </p>
                <p className="text-xs text-muted-foreground">
                  Your account is secure and private. Only you can read your
                  messages.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Username Selection
  if (step === "username") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Choose Your Username
            </h1>
            <p className="text-muted-foreground text-center">
              This is how others will find and message you
            </p>
          </div>

          {/* Username Form */}
          <form
            onSubmit={handleContinueWithUsername}
            className="space-y-4 mb-6"
          >
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Username
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    checkUsernameAvailability(e.target.value);
                  }}
                  placeholder="your_username"
                  required
                  disabled={isLoading || isCheckingUsername}
                  className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                />
                {isCheckingUsername && (
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                    <svg
                      className="animate-spin h-4 w-4 text-muted-foreground"
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
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                3-30 characters, letters, numbers, and underscores only
              </p>
              {usernameError && (
                <p className="text-xs text-destructive mt-2">{usernameError}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading || isCheckingUsername || !!usernameError}
              className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-6"
            >
              {isLoading ? (
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
                  Creating Account...
                </span>
              ) : (
                "Continue"
              )}
            </button>
          </form>

          {/* Info Box */}
          <div className="p-4 bg-secondary border border-border rounded-lg">
            <div className="flex gap-3">
              <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  Username Requirements
                </p>
                <p className="text-xs text-muted-foreground">
                  • Minimum 3 characters
                  <br />
                  • Maximum 30 characters
                  <br />
                  • No spaces or special characters
                  <br />• Must be unique
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 3: Recovery Passphrase
  if (step === "passphrase") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Save Your Recovery Passphrase
            </h1>
            <p className="text-muted-foreground text-center text-sm">
              This 24-word passphrase is the only way to recover your account if
              you lose access to this device. Write it down and store it safely.
            </p>
          </div>

          {/* Passphrase Display */}
          <div className="bg-secondary border-2 border-yellow-500/50 rounded-lg p-6 mb-6">
            <div className="grid grid-cols-2 gap-3 mb-4">
              {mnemonic.split(" ").map((word, index) => (
                <div
                  key={index}
                  className="bg-background rounded px-3 py-2 text-center text-sm font-mono"
                >
                  <span className="text-muted-foreground mr-2">
                    {index + 1}.
                  </span>
                  <span className="font-semibold">{word}</span>
                </div>
              ))}
            </div>

            <button
              onClick={copyPassphrase}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-background border border-border rounded hover:bg-primary/10 transition-all text-sm font-medium"
            >
              {copiedPassphrase ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy Passphrase
                </>
              )}
            </button>
          </div>

          {/* Warning */}
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mb-6">
            <p className="text-sm text-destructive font-semibold">
              ⚠️ Important Security Notice
            </p>
            <p className="text-xs text-destructive/80 mt-2">
              • Never share this passphrase with anyone
              <br />
              • Store it securely (write it down, password manager, etc.)
              <br />
              • Anyone with this passphrase can access your account
              <br />• There is no way to recover your account without this
              phrase
            </p>
          </div>

          {/* Action */}
          <button
            onClick={handleConfirmPassphrase}
            className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all"
          >
            I've Saved My Passphrase
          </button>

          <p className="text-xs text-muted-foreground text-center mt-6">
            Your account has been created and you're logged in. Your recovery
            passphrase and private key are stored safely on this device.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
