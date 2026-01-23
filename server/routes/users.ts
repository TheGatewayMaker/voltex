import { RequestHandler } from "express";
import {
  getUserProfile,
  getUserIdByUsername,
  getUserAccount,
} from "../lib/r2-storage";

/**
 * POST /api/users/search
 * Search for users by username (supports partial username matching)
 * Returns public profile information
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

    // Note: Since R2 doesn't support full-text search efficiently,
    // we're implementing a simple exact match + prefix match approach.
    // For a production app, consider using an external search service
    // or a database with full-text search capabilities.

    const results: any[] = [];

    // Try exact match first
    const exactMatchUserId = await getUserIdByUsername(searchQuery);
    if (exactMatchUserId) {
      const profile = await getUserProfile(exactMatchUserId);
      if (profile) {
        results.push({
          userId: exactMatchUserId,
          username: profile.username,
          displayName: profile.displayName || "User",
          bio: profile.bio || "",
          avatar: profile.avatar || null,
        });
      }
    }

    // For a better search experience in production, you would:
    // 1. Maintain a list of all usernames in a searchable format
    // 2. Use a service like Elasticsearch or Meilisearch
    // 3. Implement a prefix search with a trie or similar structure

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
