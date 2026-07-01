/**
 * Write a log line to logs/frontend.log via Tauri backend.
 * Falls back to console.log in browser mode.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export async function log(level: LogLevel, message: string) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  console.log("[Log]", line);

  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("log_frontend", { level, message });
    } catch (err) {
      // Fallback: at minimum show in browser console
      console.warn("[Logger] backend unavailable, falling back to console:", err);
    }
  }
}

export const logger = {
  debug: (msg: string) => log("debug", msg),
  info: (msg: string) => log("info", msg),
  warn: (msg: string) => log("warn", msg),
  error: (msg: string) => log("error", msg),
};
