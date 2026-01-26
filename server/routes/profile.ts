import { RequestHandler } from "express";
import { getSessionFromToken } from "./auth";
import {
  saveUserProfile,
  getUserProfile,
  getUserAccount,
} from "../lib/r2-storage";

/**
 * GET /api/profile/me
 * Get current user's profile information
 */
export const handleGetProfile: RequestHandler = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;

    if (!sessionToken) {
      return res.status(401).json({ error: "No session token provided" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    // Get profile from R2
    const profile = await getUserProfile(session.userId);

    if (!profile) {
      // Return basic profile if not found in R2
      return res.status(200).json({
        userId: session.userId,
        publicKey: session.publicKey,
        displayName: "User",
        createdAt: Date.now(),
      });
    }

    return res.status(200).json(profile);
  } catch (error) {
    console.error("Get profile error:", error);
    return res.status(500).json({ error: "Failed to retrieve profile" });
  }
};

/**
 * PUT /api/profile/me
 * Update user profile information
 */
export const handleUpdateProfile: RequestHandler = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;

    if (!sessionToken) {
      return res.status(401).json({ error: "No session token provided" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const { displayName, bio, avatar } = req.body;

    // Validate input
    if (displayName && typeof displayName !== "string") {
      return res.status(400).json({ error: "Invalid displayName" });
    }

    if (bio && typeof bio !== "string") {
      return res.status(400).json({ error: "Invalid bio" });
    }

    // Get existing profile
    let profile = await getUserProfile(session.userId);
    if (!profile) {
      profile = {
        userId: session.userId,
        publicKey: session.publicKey,
        createdAt: Date.now(),
      };
    }

    // Update profile fields
    if (displayName) profile.displayName = displayName;
    if (bio !== undefined) profile.bio = bio;
    if (avatar !== undefined) profile.avatar = avatar;

    // Save to R2
    await saveUserProfile(session.userId, profile);

    return res.status(200).json({
      message: "Profile updated successfully",
      profile,
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({ error: "Failed to update profile" });
  }
};

/**
 * GET /api/profile/:userId
 * Get public profile information for another user
 * Public endpoint - anyone can request this
 */
export const handleGetPublicProfile: RequestHandler = async (req, res) => {
  try {
    const userId =
      typeof req.params.userId === "string" ? req.params.userId : "";

    if (!userId) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // Get both profile and account to include username
    const profile = await getUserProfile(userId);
    const account = await getUserAccount(userId);

    if (!profile && !account) {
      return res.status(200).json({
        userId,
        displayName: "User",
        bio: "",
        username: null,
      });
    }

    // Only return public fields
    return res.status(200).json({
      userId,
      displayName: profile?.displayName || "User",
      bio: profile?.bio || "",
      avatar: profile?.avatar || null,
      username: account?.username || null,
      showTimestamps: profile?.showTimestamps ?? true,
    });
  } catch (error) {
    console.error("Get public profile error:", error);
    return res.status(500).json({ error: "Failed to retrieve profile" });
  }
};

/**
 * POST /api/profile/avatar
 * Upload user avatar to R2
 */
export const handleUploadAvatar: RequestHandler = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;

    if (!sessionToken) {
      return res.status(401).json({ error: "No session token provided" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const { avatar } = req.body; // Base64 encoded image

    if (!avatar || typeof avatar !== "string") {
      return res.status(400).json({ error: "Avatar data is required" });
    }

    // Get existing profile
    let profile = await getUserProfile(session.userId);
    if (!profile) {
      profile = {
        userId: session.userId,
        publicKey: session.publicKey,
        createdAt: Date.now(),
      };
    }

    // Store avatar URL or data
    profile.avatar = avatar;

    // Save to R2
    await saveUserProfile(session.userId, profile);

    return res.status(200).json({
      message: "Avatar updated successfully",
      profile,
    });
  } catch (error) {
    console.error("Upload avatar error:", error);
    return res.status(500).json({ error: "Failed to upload avatar" });
  }
};

/**
 * POST /api/profile/settings
 * Update user settings/preferences
 */
export const handleUpdateSettings: RequestHandler = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;

    if (!sessionToken) {
      return res.status(401).json({ error: "No session token provided" });
    }

    const session = await getSessionFromToken(sessionToken);
    if (!session) {
      return res.status(401).json({ error: "Invalid or expired session" });
    }

    const { notifications, privacy, showTimestamps } = req.body;

    // Get existing profile
    let profile = await getUserProfile(session.userId);
    if (!profile) {
      profile = {
        userId: session.userId,
        publicKey: session.publicKey,
        createdAt: Date.now(),
      };
    }

    // Update settings
    if (notifications !== undefined) profile.notifications = notifications;
    if (privacy !== undefined) profile.privacy = privacy;
    if (showTimestamps !== undefined) profile.showTimestamps = showTimestamps;

    // Save to R2
    await saveUserProfile(session.userId, profile);

    return res.status(200).json({
      message: "Settings updated successfully",
      profile,
    });
  } catch (error) {
    console.error("Update settings error:", error);
    return res.status(500).json({ error: "Failed to update settings" });
  }
};
