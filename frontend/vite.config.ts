import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// Serve runtime/*.json for browser/dev mode fallback
function runtimeFilesPlugin() {
  const runtimeDir = path.resolve(__dirname, "runtime");
  const files = ["default-config.json", "llama-config.json"];
  return {
    name: "runtime-files",
    configureServer(server: any) {
      for (const file of files) {
        server.middlewares.use(`/${file}`, (_req: any, res: any) => {
          try {
            const data = fs.readFileSync(path.join(runtimeDir, file), "utf-8");
            res.setHeader("Content-Type", "application/json");
            res.end(data);
          } catch {
            res.statusCode = 404;
            res.end("{}");
          }
        });
      }
    },
    // For production build: copy to dist/
    writeBundle() {
      const distDir = path.resolve(__dirname, "dist");
      fs.mkdirSync(distDir, { recursive: true });
      for (const file of files) {
        const src = path.join(runtimeDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(distDir, file));
        }
      }
    },
  };
}

// Bridge adapter: points Tauri API imports to our pywebview bridge
function bridgeAdapterPlugin() {
  const bridgePath = path.resolve(__dirname, "src/services/bridge.ts");
  const TAURI_PREFIXES = [
    "@tauri-apps/api",
    "@tauri-apps/plugin-store",
    "@tauri-apps/plugin-global-shortcut",
  ];
  return {
    name: "bridge-adapter",
    resolveId(id: string, importer: string | undefined) {
      // Redirect ALL Tauri API imports to our bridge,
      // including bare specifiers and resolved paths in node_modules.
      // Use prefix match to catch sub-paths like @tauri-apps/api/core.js
      for (const prefix of TAURI_PREFIXES) {
        if (id === prefix || id.startsWith(prefix + "/") || id.startsWith(prefix + "\\")) {
          return bridgePath;
        }
      }
      // Also catch fully-resolved paths inside @tauri-apps node_modules
      // (e.g. when internal Tauri modules import each other)
      if (importer && importer.includes("node_modules")) {
        return null; // Let normal resolution handle node_modules internal imports
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeFilesPlugin(), bridgeAdapterPlugin()],

  // Prevent Vite from obscuring Rust errors
  clearScreen: false,

  // Tauri packages are now handled by bridgeAdapterPlugin
  optimizeDeps: {
    exclude: [
      "@tauri-apps/api",
      "@tauri-apps/plugin-store",
      "@tauri-apps/plugin-global-shortcut",
    ],
  },

  server: {
    port: 5157,
    strictPort: false, // fallback to 5158, 5159... if taken
    watch: {
      ignored: ["**/src-tauri/**", "**/runtime/**", "**/config.json"],
    },
  },

  build: {
    outDir: "../web",
    emptyOutDir: true,
  },
});
