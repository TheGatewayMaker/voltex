/**
 * Centralized date formatter for consistent timestamp display
 * Ensures all messages display dates in DD-MM-YYYY HH:MM AM/PM format
 */

/**
 * Format timestamp to DD-MM-YYYY HH:MM AM/PM
 * @param timestamp - Milliseconds since epoch
 * @returns Formatted date string like "26-01-2026 02:34 PM"
 */
export function formatMessageTimestamp(timestamp: number): string {
  try {
    if (!timestamp || typeof timestamp !== "number" || timestamp <= 0) {
      return "Invalid date";
    }

    const date = new Date(timestamp);

    // Validate date is valid
    if (isNaN(date.getTime())) {
      return "Invalid date";
    }

    // Extract date components
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    // Extract time components
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    // Convert to 12-hour format
    if (hours > 12) {
      hours -= 12;
    } else if (hours === 0) {
      hours = 12;
    }

    const hoursStr = String(hours).padStart(2, "0");

    // Return in DD-MM-YYYY HH:MM AM/PM format
    return `${day}-${month}-${year} ${hoursStr}:${minutes} ${ampm}`;
  } catch (error) {
    console.error("Error formatting timestamp:", error);
    return "Invalid date";
  }
}

/**
 * Format timestamp for conversation list (shorter format)
 * Shows "HH:MM AM/PM" for today, "DD-MM-YYYY" for other dates
 * @param timestamp - Milliseconds since epoch
 * @param nowTimestamp - Current time (for comparison)
 * @returns Formatted time string
 */
export function formatConversationTime(
  timestamp: number,
  nowTimestamp: number,
): string {
  try {
    if (!timestamp || typeof timestamp !== "number" || timestamp <= 0) {
      return "now";
    }

    const date = new Date(timestamp);
    const now = new Date(nowTimestamp);

    // Validate date is valid
    if (isNaN(date.getTime())) {
      return "now";
    }

    // Check if it's today
    if (date.toDateString() === now.toDateString()) {
      // Format as HH:MM AM/PM for today
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const ampm = hours >= 12 ? "PM" : "AM";

      if (hours > 12) {
        hours -= 12;
      } else if (hours === 0) {
        hours = 12;
      }

      const hoursStr = String(hours).padStart(2, "0");
      return `${hoursStr}:${minutes} ${ampm}`;
    }

    // For past dates, show DD-MM-YYYY format
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();

    return `${day}-${month}-${year}`;
  } catch (error) {
    console.error("Error formatting conversation time:", error);
    return "now";
  }
}
