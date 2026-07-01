import { FolderOpen } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

const LOG_LEVELS: { value: string; label: string; desc: string }[] = [
  { value: "debug", label: "调试 (DEBUG)", desc: "所有操作细节" },
  { value: "info", label: "信息 (INFO)", desc: "正常操作记录" },
  { value: "warn", label: "警告 (WARN)", desc: "降级、重试" },
  { value: "error", label: "错误 (ERROR)", desc: "仅记录失败" },
];

const LOG_FILES = ["tts.log", "frontend.log", "llama.log", "piper.log"];

export default function DebugTab() {
  const settings = useConfigStore((s) => s.settings);
  const updateSettings = useConfigStore((s) => s.updateSettings);
  const isTauri = isTauriEnv();

  const openLogsDir = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_user_dir");
    } catch {}
  };

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-lexi-text">调试与日志</h3>
      <p className="text-sm text-lexi-text-muted">
        设置日志级别，出问题时将级别改为"调试"可记录详细信息。
      </p>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-lexi-text">日志级别</span>
          <select
            value={settings.logLevel || "info"}
            onChange={async (e) => {
              const level = e.target.value;
              updateSettings({ logLevel: level as any });
              if (isTauri) {
                const lvlMap: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  await invoke("set_log_level", { level: lvlMap[level] });
                } catch {}
              }
            }}
            className="bg-lexi-input text-lexi-text border border-lexi-border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-lexi-accent"
          >
            {LOG_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          {LOG_LEVELS.map((l) => (
            <p
              key={l.value}
              className={`text-xs ${settings.logLevel === l.value ? "text-lexi-accent" : "text-lexi-text-muted/50"}`}
            >
              {l.label} — {l.desc}
            </p>
          ))}
        </div>
      </div>

      <div className="border-t border-lexi-border pt-4">
        <h4 className="text-sm font-medium text-lexi-text mb-2">日志文件</h4>
        <div className="space-y-1 mb-3">
          {LOG_FILES.map((f) => (
            <div key={f} className="text-xs text-lexi-text-muted font-mono">
              logs/{f}
            </div>
          ))}
        </div>
        <button
          onClick={openLogsDir}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-lexi-accent-hover hover:bg-lexi-accent/10 transition-colors w-full justify-center"
        >
          <FolderOpen size={13} />
          <span>打开应用目录</span>
        </button>
      </div>
    </div>
  );
}
