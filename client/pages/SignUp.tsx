import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock, Copy, Check } from "lucide-react";
import {
  generateKeyPair,
  generateMnemonicPhrase,
  deriveUserIdFromPublicKey,
  storeKeyPair,
  storeMnemonic,
} from "@/lib/crypto";
import { toast } from "sonner";

type SignUpStep = "info" | "generating" | "mnemonic" | "created";

export default function SignUp() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SignUpStep>("info");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mnemonicPhrase, setMnemonicPhrase] = useState("");
  const [userId, setUserId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [copiedMnemonic, setCopiedMnemonic] = useState(false);

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim()) {
      setError("Display name is required");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Step 1: Generate key pair locally
      setStep("generating");
      const keyPair = generateKeyPair();

      // Step 2: Generate mnemonic for recovery
      const mnemonic = generateMnemonicPhrase();

      // Step 3: Derive user ID from public key
      const derivedUserId = await deriveUserIdFromPublicKey(
        keyPair.publicKeyBase64,
      );

      // Step 4: Register account on server
      const registerResponse = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKey: keyPair.publicKeyBase64,
        }),
      });

      if (!registerResponse.ok) {
        const errorData = await registerResponse.json();
        throw new Error(errorData.error || "Registration failed");
      }

      // Step 5: Store keys locally (encrypted in production)
      storeKeyPair(keyPair);
      storeMnemonic(mnemonic.mnemonic);

      // Set state for display
      setMnemonicPhrase(mnemonic.mnemonic);
      setUserId(derivedUserId);
      setPublicKey(keyPair.publicKeyBase64);
      setStep("mnemonic");

      setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Account creation failed");
    }
  };

  const handleSaveMnemonic = () => {
    // In production, user should confirm they've saved the mnemonic
    setStep("created");
  };

  const copyMnemonic = () => {
    navigator.clipboard.writeText(mnemonicPhrase);
    setCopiedMnemonic(true);
    toast.success("Mnemonic copied to clipboard");
    setTimeout(() => setCopiedMnemonic(false), 2000);
  };

  const handleContinue = () => {
    // Store in session that user is logged in
    localStorage.setItem("current_user_id", userId);
    navigate("/");
  };

  // Step 1: Account Information
  if (step === "info") {
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
                className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
              />
              <p className="text-xs text-muted-foreground mt-2">
                This is your display name for other users
              </p>
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
                  Privacy First
                </p>
                <p className="text-xs text-muted-foreground">
                  Your account is secured with a cryptographic key pair. Only
                  you can decrypt your messages.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Generating Keys
  if (step === "generating") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <div className="mb-8">
            <svg
              className="animate-spin h-12 w-12 mx-auto text-primary"
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
          <h2 className="text-2xl font-bold mb-2">Generating Keys</h2>
          <p className="text-muted-foreground">
            Creating your secure cryptographic key pair. This may take a
            moment...
          </p>
        </div>
      </div>
    );
  }

  // Step 3: Mnemonic Recovery Phrase
  if (step === "mnemonic") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Save Your Recovery Phrase
            </h1>
            <p className="text-muted-foreground text-center">
              This phrase can restore your account on any device. Keep it safe
              and secret.
            </p>
          </div>

          {/* Mnemonic Display */}
          <div className="bg-secondary border-2 border-yellow-500/50 rounded-lg p-6 mb-6">
            <div className="grid grid-cols-2 gap-3 mb-4">
              {mnemonicPhrase.split(" ").map((word, index) => (
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
              onClick={copyMnemonic}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-background border border-border rounded hover:bg-primary/10 transition-all text-sm font-medium"
            >
              {copiedMnemonic ? (
                <>
                  <Check className="w-4 h-4" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  Copy to Clipboard
                </>
              )}
            </button>
          </div>

          {/* Warning */}
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mb-6">
            <p className="text-sm text-destructive font-semibold">
              ⚠️ Store this phrase securely
            </p>
            <p className="text-xs text-destructive/80 mt-2">
              • Never share this phrase with anyone
              <br />
              • Save it in a secure location (password manager, safe, etc.)
              <br />• Anyone with this phrase can access your account
            </p>
          </div>

          {/* Action */}
          <button
            onClick={handleSaveMnemonic}
            className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all"
          >
            I've Saved My Recovery Phrase
          </button>

          <p className="text-xs text-muted-foreground text-center mt-6">
            Your account has been created on the server. Your private key is
            stored locally on this device only.
          </p>
        </div>
      </div>
    );
  }

  // Step 4: Account Created
  if (step === "created") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mb-6">
              <Check className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Account Created!
            </h1>
            <p className="text-muted-foreground text-center">
              Your secure account is ready to use
            </p>
          </div>

          {/* Account Info */}
          <div className="bg-secondary border border-border rounded-lg p-6 mb-6 space-y-4">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Your User ID</p>
              <p className="font-mono text-sm font-semibold break-all text-primary">
                {userId}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">
                Public Key (for encryption)
              </p>
              <p className="font-mono text-xs font-semibold break-all text-muted-foreground">
                {publicKey.substring(0, 32)}...
              </p>
            </div>
          </div>

          {/* Features */}
          <div className="space-y-3 mb-8">
            <div className="flex gap-3">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">End-to-End Encrypted</p>
                <p className="text-xs text-muted-foreground">
                  Only you can read your messages
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Private Key Secure</p>
                <p className="text-xs text-muted-foreground">
                  Stored only on your device
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <Check className="w-5 h-5 text-green-500 flex-shrink-0" />
              <div>
                <p className="font-semibold text-sm">Recovery Phrase</p>
                <p className="text-xs text-muted-foreground">
                  Restore your account anytime
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleContinue}
            className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all mb-3"
          >
            Continue to Conversations
          </button>

          <Link
            to="/signin"
            className="block w-full py-3 border-2 border-primary text-primary font-semibold rounded-lg hover:bg-primary/10 transition-all text-center"
          >
            Sign In on Another Device
          </Link>
        </div>
      </div>
    );
  }

  return null;
}
