/**
 * Write a log line to the Python backend (pywebview).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export async function log(level: LogLevel, message: string) {
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  console.log("[Log]", line);

  try {
    const { invoke } = await import("./bridge");
    await invoke("log_frontend", { level, message });
  } catch (err) {
    console.warn("[Logger] backend unavailable:", err);
  }
}

export const logger = {
  debug: (msg: string) => log("debug", msg),
  info: (msg: string) => log("info", msg),
  warn: (msg: string) => log("warn", msg),
  error: (msg: string) => log("error", msg),
};
