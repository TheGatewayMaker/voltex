import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";

export default function SignIn() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      // Navigate to conversations on success
      navigate("/");
    }, 800);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo & Title */}
        <div className="flex flex-col items-center mb-12">
          <div className="w-16 h-16 bg-gradient-to-br from-primary to-primary/80 rounded-2xl flex items-center justify-center mb-6">
            <Lock className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-foreground mb-2">
            Voltex Everywhere
          </h1>
          <p className="text-muted-foreground text-center">
            Secure messaging, end-to-end encrypted
          </p>
        </div>

        {/* Sign In Form */}
        <form onSubmit={handleSignIn} className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="w-full px-4 py-3 bg-secondary border border-border text-foreground placeholder-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-primary text-white font-semibold rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-6"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="animate-spin h-4 w-4"
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
                Signing in...
              </span>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        {/* Forgot Password Link */}
        <div className="text-center mb-8">
          <button className="text-primary hover:text-primary/80 text-sm font-medium transition-colors">
            Forgot password?
          </button>
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 h-px bg-border"></div>
          <span className="text-muted-foreground text-sm">New to Voltex?</span>
          <div className="flex-1 h-px bg-border"></div>
        </div>

        {/* Sign Up Link */}
        <Link
          to="/signup"
          className="block w-full py-3 border-2 border-primary text-primary font-semibold rounded-lg hover:bg-primary/10 transition-all text-center"
        >
          Create Account
        </Link>

        {/* Security Note */}
        <div className="mt-12 p-4 bg-secondary border border-border rounded-lg">
          <div className="flex gap-3">
            <Lock className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground mb-1">
                End-to-End Encrypted
              </p>
              <p className="text-xs text-muted-foreground">
                Your messages are encrypted and can only be read by you and the people you send them to.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
