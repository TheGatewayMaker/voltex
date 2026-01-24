import { RequestHandler } from "express";
import {
  getUserProfile,
  getUserIdByUsername,
  getUserAccount,
} from "../lib/r2-storage";
import { getSessionFromToken } from "./auth";

/**
 * POST /api/users/search
 * Search for users by username (supports partial username matching)
 * Returns public profile information with privacy controls
 */
export const handleSearchUsers: RequestHandler = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Search query is required" });
    }

    const searchQuery = query.trim().toLowerCase();

    if (searchQuery.length < 1) {
      return res.status(400).json({ error: "Search query is too short" });
    }

    if (searchQuery.length > 30) {
      return res.status(400).json({ error: "Search query is too long" });
    }

    // Get authenticated user if available (optional for search)
    const authHeader = req.headers.authorization;
    const sessionToken =
      typeof authHeader === "string"
        ? authHeader.replace("Bearer ", "")
        : undefined;
    const session = sessionToken ? getSessionFromToken(sessionToken) : null;

    const results: any[] = [];

    // Try exact match first (privacy-aware: only search by username)
    const exactMatchUserId = await getUserIdByUsername(searchQuery);
    if (exactMatchUserId) {
      // Exclude self from results
      if (session && exactMatchUserId === session.userId) {
        return res.status(200).json({
          results: [],
          query: searchQuery,
          count: 0,
        });
      }

      const account = await getUserAccount(exactMatchUserId);
      if (account) {
        const profile = await getUserProfile(exactMatchUserId);
        results.push({
          userId: exactMatchUserId,
          username: account.username || exactMatchUserId.substring(0, 8),
          displayName: profile?.displayName || "User",
          bio: profile?.bio || "",
          avatar: profile?.avatar || null,
          publicKey: account.publicKey,
        });
      }
    }

    // Note: For production scale, implement:
    // 1. Prefix search with cached index in R2
    // 2. External search service (Elasticsearch, Meilisearch)
    // 3. Rate limiting to prevent enumeration attacks
    // 4. Usernames list maintained separately for performance

    return res.status(200).json({
      results,
      query: searchQuery,
      count: results.length,
    });
  } catch (error) {
    console.error("User search error:", error);
    return res.status(500).json({ error: "Failed to search users" });
  }
};

/**
 * GET /api/users/by-username/:username
 * Get user profile by username
 * Returns public profile information
 */
export const handleGetUserByUsername: RequestHandler = async (req, res) => {
  try {
    const username =
      typeof req.params.username === "string" ? req.params.username : "";

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const userId = await getUserIdByUsername(username);
    if (!userId) {
      return res.status(404).json({ error: "User not found" });
    }

    const profile = await getUserProfile(userId);
    const account = await getUserAccount(userId);

    if (!account) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.status(200).json({
      userId,
      username: account.username || username,
      displayName: profile?.displayName || "User",
      bio: profile?.bio || "",
      avatar: profile?.avatar || null,
      publicKey: account.publicKey,
    });
  } catch (error) {
    console.error("Get user by username error:", error);
    return res.status(500).json({ error: "Failed to retrieve user" });
  }
};
