import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import ProfileMenu from "./ProfileMenu";

interface LayoutProps {
  children: ReactNode;
  showBack?: boolean;
  title?: string;
  onBackClick?: () => void;
}

export default function Layout({
  children,
  showBack,
  title,
  onBackClick,
}: LayoutProps) {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header */}
      <header className="bg-card border-b border-border px-4 py-3 md:px-6 md:py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {showBack ? (
              <button
                onClick={onBackClick}
                className="md:hidden text-primary hover:text-primary/80 transition-colors"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
            ) : null}
            {!showBack && (
              <Link to="/" className="flex items-center gap-2">
                <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-primary to-primary/80 rounded-lg flex items-center justify-center">
                  <Lock className="w-5 h-5 md:w-6 md:h-6 text-white" />
                </div>
                <h1 className="hidden sm:block font-bold text-lg md:text-xl text-foreground">
                  Voltex
                </h1>
              </Link>
            )}
            {showBack && title && (
              <h2 className="font-semibold text-base md:text-lg truncate">
                {title}
              </h2>
            )}
          </div>
          {!showBack && (
            <div className="flex items-center gap-2">
              <button className="p-2 hover:bg-secondary rounded-lg transition-colors">
                <svg
                  className="w-5 h-5 md:w-6 md:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </button>
              <button className="p-2 hover:bg-secondary rounded-lg transition-colors">
                <svg
                  className="w-5 h-5 md:w-6 md:h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                  />
                </svg>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
