import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import { signChallenge, deriveUserIdFromPublicKey } from "@/lib/crypto";
import {
  normalizePassphrase,
  deriveEncryptionKey,
  decryptKeypair,
} from "@/lib/passphrase";
import { toast } from "sonner";

type RecoverStep = "userId" | "passphrase" | "authenticating" | "success";

export default function Recover() {
  const navigate = useNavigate();
  const [step, setStep] = useState<RecoverStep>("userId");
  const [userIdInput, setUserIdInput] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [recoveredUserId, setRecoveredUserId] = useState("");
  const [recoveredPublicKey, setRecoveredPublicKey] = useState("");

  const handleCheckUserId = (e: React.FormEvent) => {
    e.preventDefault();

    if (!userIdInput.trim()) {
      setError("User ID is required");
      return;
    }

    setError("");
    setStep("passphrase");
  };

  const handleRecoverAccount = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!passphraseInput.trim()) {
      setError("Passphrase is required");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Normalize and hash the passphrase
      // Normalization ensures that variations in spacing and capitalization don't break recovery
      const normalizedPassphrase = normalizePassphrase(passphraseInput);
      const passphraseHashHex = await hashPassphrase(normalizedPassphrase);

      // Request account recovery
      const recoveryResponse = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userIdInput,
          passphraseHash: passphraseHashHex,
        }),
      });

      if (!recoveryResponse.ok) {
        const errorData = await recoveryResponse.json();
        throw new Error(errorData.error || "Account recovery failed");
      }

      const recoveryData = await recoveryResponse.json();

      // Store recovered data temporarily for authentication
      setRecoveredUserId(recoveryData.userId);
      setRecoveredPublicKey(recoveryData.publicKey);
      setStep("authenticating");

      // Proceed with challenge-response authentication
      const challengeResponse = await fetch("/api/auth/challenge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: recoveryData.userId,
          publicKey: recoveryData.publicKey,
        }),
      });

      if (!challengeResponse.ok) {
        const errorData = await challengeResponse.json();
        throw new Error(errorData.error || "Failed to get challenge");
      }

      const challengeData = await challengeResponse.json();
      const challenge = challengeData.challenge;

      // Sign the challenge with the passphrase (derive key from passphrase)
      // For recovery, we can't use the original private key, so we derive it from the passphrase
      // This is a simplified approach - in production, you'd want a proper key derivation function

      // For now, we'll ask the user to use their original device or provide their private key
      // Let's redirect them to restore their keypair from their original device

      toast.error(
        "To complete recovery, please use a device with your original cryptographic keys installed",
      );

      // Navigate back to signin
      setTimeout(() => {
        setStep("userId");
        setPassphraseInput("");
        setUserIdInput("");
      }, 2000);
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : "Account recovery failed");
      toast.error(
        err instanceof Error ? err.message : "Account recovery failed",
      );
    }
  };

  const handleBackToUserId = () => {
    setStep("userId");
    setPassphraseInput("");
    setError("");
  };

  // Step 1: Enter User ID
  if (step === "userId") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-12">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Recover Account
            </h1>
            <p className="text-muted-foreground text-center">
              Restore your account using your recovery passphrase
            </p>
          </div>

          {/* Recovery Form */}
          <form onSubmit={handleCheckUserId} className="space-y-4 mb-6">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Your User ID
              </label>
              <input
                type="text"
                value={userIdInput}
                onChange={(e) => {
                  setUserIdInput(e.target.value);
                  setError("");
                }}
                placeholder="Enter your 16-character user ID"
                required
                className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-mono"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-6"
            >
              Continue
            </button>
          </form>

          {/* Back to Sign In */}
          <Link
            to="/signin"
            className="block w-full py-3 border-2 border-border text-foreground font-semibold rounded-lg hover:bg-secondary transition-all text-center"
          >
            Back to Sign In
          </Link>

          {/* Info */}
          <div className="mt-12 p-4 bg-secondary border border-border rounded-lg">
            <div className="flex gap-3">
              <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  Recovery Process
                </p>
                <p className="text-xs text-muted-foreground">
                  Enter your User ID and recovery passphrase. We'll verify your
                  identity and help you restore access to your account.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Enter Passphrase
  if (step === "passphrase") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-12">
            <div className="w-16 h-16 bg-gradient-to-br from-yellow-500 to-yellow-600 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Enter Recovery Passphrase
            </h1>
            <p className="text-muted-foreground text-center text-sm">
              Enter the 24-word passphrase you saved when creating your account
            </p>
          </div>

          {/* Passphrase Form */}
          <form onSubmit={handleRecoverAccount} className="space-y-4 mb-6">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Recovery Passphrase
              </label>
              <textarea
                value={passphraseInput}
                onChange={(e) => {
                  setPassphraseInput(e.target.value);
                  setError("");
                }}
                placeholder="Paste your 24-word recovery passphrase here"
                rows={4}
                required
                disabled={isLoading}
                className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-mono text-sm resize-none disabled:opacity-50 disabled:cursor-not-allowed"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
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
                  Recovering Account...
                </span>
              ) : (
                "Recover Account"
              )}
            </button>
          </form>

          {/* Back Button */}
          <button
            onClick={handleBackToUserId}
            className="w-full py-3 border-2 border-border text-foreground font-semibold rounded-lg hover:bg-secondary transition-all"
          >
            Back
          </button>

          {/* Warning */}
          <div className="bg-destructive/10 border border-destructive rounded-lg p-4 mt-6">
            <p className="text-sm text-destructive font-semibold">
              ⚠️ Important
            </p>
            <p className="text-xs text-destructive/80 mt-2">
              To complete account recovery, you'll need access to your original
              cryptographic keys or a device where they are installed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
