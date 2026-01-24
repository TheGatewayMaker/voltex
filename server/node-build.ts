import path from "path";
import * as serverModule from "./index.js";
import express from "express";
import { createServer as createHttpServer } from "http";

async function main() {
  // Explicitly handle the import to ensure proper resolution
  const createServerFn =
    typeof serverModule.createServer === "function"
      ? serverModule.createServer
      : serverModule.default?.createServer;

  if (!createServerFn || typeof createServerFn !== "function") {
    throw new Error("Failed to import createServer function");
  }

  const result = await createServerFn();

  if (!result || typeof result !== "object") {
    throw new Error("createServer did not return a valid object");
  }

  const { app, wss } = result;

  if (!app) {
    throw new Error("createServer returned undefined app");
  }

  const port = process.env.PORT || 3000;

  // Create HTTP server
  const httpServer = createHttpServer(app);

  // Attach WebSocket server to HTTP server
  if (wss) {
    httpServer.on("upgrade", (request, socket, head) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });
  }

  // In production, serve the built SPA files
  const __dirname = import.meta.dirname;
  const distPath = path.join(__dirname, "../spa");

  // Serve static files
  app.use(express.static(distPath));

  // Handle React Router - serve index.html for all non-API routes
  app.get("*", (req, res) => {
    // Don't serve index.html for API routes
    if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
      return res.status(404).json({ error: "API endpoint not found" });
    }

    res.sendFile(path.join(distPath, "index.html"));
  });

  httpServer.listen(port, () => {
    console.log(`🚀 Fusion Starter server running on port ${port}`);
    console.log(`📱 Frontend: http://localhost:${port}`);
    console.log(`🔧 API: http://localhost:${port}/api`);
    console.log(`🔌 WebSocket: ws://localhost:${port}`);
  });

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log("🛑 Received SIGTERM, shutting down gracefully");
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("🛑 Received SIGINT, shutting down gracefully");
    process.exit(0);
  });
}

// Start the server
main().catch((error) => {
  console.error("🔥 Failed to start server:", error);
  process.exit(1);
});
