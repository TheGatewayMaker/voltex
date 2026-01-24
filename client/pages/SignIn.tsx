import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import {
  getStoredKeyPair,
  signChallenge,
  deriveUserIdFromPublicKey,
} from "@/lib/crypto";
import {
  normalizePassphrase,
  deriveEncryptionKey,
  decryptKeypair,
} from "@/lib/passphrase";
import { toast } from "sonner";

type SignInStep = "userId" | "passphrase" | "authenticating" | "success";

export default function SignIn() {
  const navigate = useNavigate();
  const [step, setStep] = useState<SignInStep>("userId");
  const [userIdInput, setUserIdInput] = useState("");
  const [passphraseInput, setPassphraseInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [authenticatedUserId, setAuthenticatedUserId] = useState("");
  const [encryptionData, setEncryptionData] = useState<{
    userId: string;
    encryptedData: string;
    salt: string;
    iv: string;
  } | null>(null);

  const authenticateWithKeyPair = async (
    userId: string,
    keyPair: any,
  ) => {
    try {
      // Request challenge from server
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

      const challengeData = await challengeResponse.json();
      const challenge = challengeData.challenge;

      // Sign the challenge with private key
      const signature = signChallenge(challenge, keyPair.privateKeyBase64);

      // Verify signed challenge with server
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

      const authData = await verifyResponse.json();

      // Store session token and user ID
      localStorage.setItem("session_token", authData.sessionToken);
      localStorage.setItem("current_user_id", authData.userId);
      localStorage.setItem("current_public_key", keyPair.publicKeyBase64);

      setAuthenticatedUserId(authData.userId);
      setStep("success");

      // Redirect after a short delay
      setTimeout(() => navigate("/"), 1500);
    } catch (err) {
      throw err;
    }
  };

  const handleCheckUserId = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!userIdInput.trim()) {
      setError("User ID is required");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Check if keypair exists locally
      const storedKeyPair = getStoredKeyPair();

      if (storedKeyPair) {
        // Verify that the stored key pair matches the provided user ID
        const derivedUserId = await deriveUserIdFromPublicKey(
          storedKeyPair.publicKeyBase64,
        );

        if (userIdInput !== derivedUserId) {
          throw new Error(
            "User ID does not match your stored account on this device",
          );
        }

        // Same-device signin: proceed with challenge-response
        await authenticateWithKeyPair(derivedUserId, storedKeyPair);
      } else {
        // Cross-device signin: fetch encrypted keypair from R2 and ask for passphrase
        const encryptedKeypairResponse = await fetch(
          `/api/auth/encrypted-keypair/${userIdInput}`,
        );

        if (!encryptedKeypairResponse.ok) {
          if (encryptedKeypairResponse.status === 404) {
            throw new Error("User not found");
          }
          throw new Error("Failed to fetch account");
        }

        const encryptedKeypairData =
          await encryptedKeypairResponse.json();

        setEncryptionData({
          userId: userIdInput,
          encryptedData: encryptedKeypairData.encryptedData,
          salt: encryptedKeypairData.salt,
          iv: encryptedKeypairData.iv,
        });

        setStep("passphrase");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handlePassphraseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!passphraseInput.trim()) {
      setError("Passphrase is required");
      return;
    }

    if (!encryptionData) {
      setError("Session expired. Please start over.");
      setStep("userId");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Derive decryption key from passphrase
      const normalizedPassphrase = normalizePassphrase(passphraseInput);
      const decryptionKey = await deriveEncryptionKey(
        normalizedPassphrase,
        encryptionData.salt,
      );

      // Decrypt keypair
      const decryptedKeypair = await decryptKeypair(
        encryptionData.encryptedData,
        encryptionData.iv,
        decryptionKey,
      );

      if (!decryptedKeypair) {
        throw new Error("Failed to decrypt keypair. Invalid passphrase?");
      }

      // Verify the decrypted keypair matches the user ID
      const derivedUserId = await deriveUserIdFromPublicKey(
        decryptedKeypair.publicKeyBase64,
      );

      if (encryptionData.userId !== derivedUserId) {
        throw new Error("Decrypted keypair does not match user ID");
      }

      // Now authenticate with the decrypted keypair
      await authenticateWithKeyPair(encryptionData.userId, decryptedKeypair);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsLoading(false);
    }
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
            <h1 className="text-3xl font-bold text-foreground mb-2">Voltex</h1>
            <p className="text-muted-foreground text-center">
              Secure messaging, end-to-end encrypted
            </p>
          </div>

          {/* Sign In Form */}
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
              <p className="text-xs text-muted-foreground mt-2">
                Your user ID is derived from your cryptographic public key
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
                  Authenticating...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-8">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-muted-foreground text-sm">
              New to Voltex?
            </span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          {/* Sign Up Link */}
          <Link
            to="/signup"
            className="block w-full py-3 border-2 border-primary text-primary font-semibold rounded-lg hover:bg-primary/10 transition-all text-center mb-3"
          >
            Create Account
          </Link>

          {/* Recovery Link */}
          <Link
            to="/recover"
            className="block w-full py-2 text-sm text-primary hover:text-primary/80 transition-all text-center font-medium"
          >
            Recover using passphrase
          </Link>

          {/* Info */}
          <div className="mt-12 space-y-4">
            <div className="p-4 bg-secondary border border-border rounded-lg">
              <div className="flex gap-3">
                <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground mb-1">
                    How It Works
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Enter your user ID to begin. Your private key on this device
                    will sign a cryptographic challenge to authenticate you
                    securely.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 bg-blue-500/10 border border-blue-500/50 rounded-lg">
              <p className="text-xs text-blue-600 font-medium">
                💡 Tip: Your user ID is displayed when you create your account.
                You can also restore your account using your recovery phrase on
                a new device.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2: Enter Passphrase (for cross-device signin)
  if (step === "passphrase") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          {/* Logo & Title */}
          <div className="flex flex-col items-center mb-12">
            <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center mb-6">
              <Lock className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-foreground mb-2">
              Recovery Passphrase
            </h1>
            <p className="text-muted-foreground text-center">
              Enter your 24-word recovery passphrase to sign in
            </p>
          </div>

          {/* Passphrase Form */}
          <form onSubmit={handlePassphraseSubmit} className="space-y-4 mb-6">
            {error && (
              <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-lg text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                Your 24-Word Passphrase
              </label>
              <textarea
                value={passphraseInput}
                onChange={(e) => {
                  setPassphraseInput(e.target.value);
                  setError("");
                }}
                placeholder="word1 word2 word3 ... word24"
                required
                disabled={isLoading}
                className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all font-mono text-sm resize-none h-24 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Enter the 24 words separated by spaces
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
                  Decrypting...
                </span>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Back Link */}
          <button
            onClick={() => {
              setStep("userId");
              setPassphraseInput("");
              setError("");
              setEncryptionData(null);
            }}
            className="w-full text-sm text-primary hover:text-primary/80 transition-all text-center font-medium py-2"
          >
            Back to User ID
          </button>

          {/* Info */}
          <div className="mt-12 p-4 bg-secondary border border-border rounded-lg">
            <div className="flex gap-3">
              <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  Cross-Device Sign In
                </p>
                <p className="text-xs text-muted-foreground">
                  Your encrypted keys are stored securely in cloud storage. Only
                  you can decrypt them with your passphrase. Enter your 24-word
                  recovery passphrase to proceed.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 3: Success
  if (step === "success") {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md text-center">
          <div className="mb-8">
            <svg
              className="animate-pulse h-16 w-16 mx-auto text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-3xl font-bold mb-2">Welcome Back!</h2>
          <p className="text-muted-foreground mb-8">
            You've been successfully authenticated. Redirecting...
          </p>
          <p className="text-sm text-muted-foreground font-mono break-all">
            {authenticatedUserId}
          </p>
        </div>
      </div>
    );
  }

  return null;
}
