import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { User, Settings, LogOut } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";

interface ProfileMenuProps {
  userId?: string;
  displayName?: string;
  avatar?: string;
}

export default function ProfileMenu({
  userId = "",
  displayName = "User",
  avatar,
}: ProfileMenuProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      const sessionToken = localStorage.getItem("session_token");

      if (sessionToken) {
        await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        });
      }

      // Clear local storage
      localStorage.removeItem("session_token");
      localStorage.removeItem("current_user_id");
      localStorage.removeItem("current_public_key");
      localStorage.removeItem("crypto_keypair");

      toast.success("Logged out successfully");
      navigate("/signin");
    } catch (error) {
      console.error("Logout error:", error);
      toast.error("Failed to logout");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAccount = () => {
    navigate("/account");
  };

  const handleSettings = () => {
    navigate("/settings");
  };

  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="p-2 hover:bg-secondary rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary">
          <Avatar className="h-8 w-8">
            {avatar && <AvatarImage src={avatar} alt={displayName} />}
            <AvatarFallback className="bg-primary text-white text-sm font-semibold">
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        {/* User Info */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-semibold text-foreground truncate">
            {displayName}
          </p>
          <p className="text-xs text-muted-foreground font-mono truncate">
            {userId}
          </p>
        </div>

        {/* Account Button */}
        <DropdownMenuItem onClick={handleAccount} className="cursor-pointer">
          <User className="w-4 h-4 mr-2" />
          <span>Account</span>
        </DropdownMenuItem>

        {/* Settings Button */}
        <DropdownMenuItem onClick={handleSettings} className="cursor-pointer">
          <Settings className="w-4 h-4 mr-2" />
          <span>Settings</span>
        </DropdownMenuItem>

        {/* Separator */}
        <DropdownMenuSeparator />

        {/* Logout Button */}
        <DropdownMenuItem
          onClick={handleLogout}
          disabled={isLoading}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="w-4 h-4 mr-2" />
          <span>{isLoading ? "Logging out..." : "Logout"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
