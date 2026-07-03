import { useState, useEffect } from "react";
import { FolderOpen, FileText, Clock } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

const LOG_LEVELS: { value: string; label: string; desc: string }[] = [
  { value: "debug", label: "调试 (DEBUG)", desc: "所有操作细节" },
  { value: "info", label: "信息 (INFO)", desc: "正常操作记录" },
  { value: "warn", label: "警告 (WARN)", desc: "降级、重试" },
  { value: "error", label: "错误 (ERROR)", desc: "仅记录失败" },
];

interface LogInfo {
  filename: string;
  dir: string;
}

export default function DebugTab() {
  const settings = useConfigStore((s) => s.settings);
  const updateSettings = useConfigStore((s) => s.updateSettings);

  const [logInfo, setLogInfo] = useState<LogInfo | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { invoke } = await import("../../services/bridge");
        const info = await invoke<LogInfo>("get_log_info");
        setLogInfo(info);
      } catch { /* ignore */ }
    })();
  }, []);

  const openLogsDir = async () => {
    try {
      const { invoke } = await import("../../services/bridge");
      await invoke("open_logs_dir");
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
              const lvlMap: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
              try {
                const { invoke } = await import("../../services/bridge");
                await invoke("set_log_level", { level: lvlMap[level] });
              } catch {}
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
        {logInfo ? (
          <div className="flex items-center gap-3 mb-3 rounded-lg bg-lexi-input border border-lexi-border px-3 py-2.5">
            <FileText size={16} className="text-lexi-accent flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <span className="text-sm text-lexi-text font-mono truncate block">
                {logInfo.filename || "app.log"}
              </span>
              <span className="text-xs text-lexi-text-muted flex items-center gap-1 mt-0.5">
                <Clock size={10} />
                {logInfo.dir}/logs/
              </span>
            </div>
          </div>
        ) : (
          <div className="mb-3 rounded-lg bg-lexi-input border border-lexi-border px-3 py-2.5">
            <span className="text-sm text-lexi-text-muted">加载中...</span>
          </div>
        )}

        <button
          onClick={openLogsDir}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-lexi-accent-hover hover:bg-lexi-accent/10 transition-colors w-full justify-center"
        >
          <FolderOpen size={13} />
          <span>打开日志目录</span>
        </button>
      </div>
    </div>
  );
}
