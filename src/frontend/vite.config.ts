import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "fs";
import path from "path";

// Serve runtime/*.json for browser/dev mode fallback
function runtimeFilesPlugin() {
  const runtimeDir = path.resolve(__dirname, "../../runtime");
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
    // For production build: copy to runtime/web/
    writeBundle() {
      const distDir = path.resolve(__dirname, "../../runtime/web");
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

export default defineConfig({
  plugins: [react(), tailwindcss(), runtimeFilesPlugin()],

  clearScreen: false,

  server: {
    port: 5157,
    strictPort: false,
    watch: {
      ignored: ["**/runtime/**", "**/config.json"],
    },
  },

  build: {
    outDir: "../../runtime/web",
    emptyOutDir: true,
  },
});
