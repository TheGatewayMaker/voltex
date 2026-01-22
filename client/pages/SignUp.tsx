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
import { toast } from "sonner";

type SignUpStep = "form" | "passphrase" | "completed";

export default function SignUp() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SignUpStep>("form");
  const [displayName, setDisplayName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [userId, setUserId] = useState("");
  const [sessionToken, setSessionToken] = useState("");
  const [copiedPassphrase, setCopiedPassphrase] = useState(false);

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
      const keyPair = generateKeyPair();

      // Generate mnemonic for recovery
      const mnemonic = generateMnemonicPhrase();

      // Derive user ID from public key
      const userId = await deriveUserIdFromPublicKey(keyPair.publicKeyBase64);

      // Register account on server
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

      // Get challenge for authentication
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
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
          userId,
          challenge,
          signature,
          publicKey: keyPair.publicKeyBase64,
        }),
      });

      if (!verifyResponse.ok) {
        const errorData = await verifyResponse.json();
        throw new Error(errorData.error || "Authentication failed");
      }

      const { sessionToken } = await verifyResponse.json();

      // Store keys and session locally
      storeKeyPair(keyPair);
      storeMnemonic(mnemonic.mnemonic);
      localStorage.setItem("session_token", sessionToken);
      localStorage.setItem("current_user_id", userId);
      localStorage.setItem("current_public_key", keyPair.publicKeyBase64);

      // Navigate to conversations page
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account creation failed");
      toast.error(err instanceof Error ? err.message : "Account creation failed");
    } finally {
      setIsLoading(false);
    }
  };

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
