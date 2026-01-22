import { defineConfig, Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { createServer } from "./server";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    fs: {
      allow: [".", "./client", "./shared"],
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "server/**"],
    },
  },
  build: {
    outDir: "dist/spa",
  },
  plugins: [react(), expressPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./client"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
}));

function expressPlugin(): Plugin {
  let httpServer: any;

  return {
    name: "express-plugin",
    apply: "serve", // Only apply during development (serve mode)
    configureServer(server) {
      const { app, wss } = createServer();

      // Add Express app as middleware to Vite dev server
      server.middlewares.use(app);

      // Store the HTTP server reference
      return () => {
        httpServer = server.httpServer;

        // Handle WebSocket upgrades
        if (httpServer) {
          httpServer.on("upgrade", (req: any, socket: any, head: any) => {
            if (req.url?.startsWith("/ws")) {
              wss.handleUpgrade(req, socket, head, (ws: any) => {
                wss.emit("connection", ws, req);
              });
            }
          });
        }
      };
    },
  };
}
