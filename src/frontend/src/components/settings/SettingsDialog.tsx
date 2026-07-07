import { useState, useEffect } from "react";
import { Download, Upload, Globe, Keyboard, Palette, Database, Volume2, FolderOpen, Cpu, Bug, WifiOff, LogOut } from "lucide-react";
import ApiConfig from "./ApiConfig";
import ShortcutTab from "./ShortcutTab";
import LocalModelTab from "./LocalModelTab";
import TTSTab from "./TTSTab";
import DebugTab from "./DebugTab";
import BergamotTab from "./BergamotTab";
import { useConfigStore } from "../../stores/configStore";
import { useHistoryStore } from "../../stores/historyStore";

interface SettingsDialogProps {
  onClose: () => void;
  defaultTab?: SettingsTab;
}

type SettingsTab = "api" | "webdav" | "localModel" | "bergamot" | "shortcut" | "appearance" | "tts" | "debug" | "exit";

const TABS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { key: "api", label: "API 配置", icon: <Globe size={16} /> },
  { key: "webdav", label: "WebDAV 同步", icon: <Database size={16} /> },
  { key: "localModel", label: "本地模型", icon: <Cpu size={16} /> },
  { key: "bergamot", label: "离线翻译", icon: <WifiOff size={16} /> },
  { key: "shortcut", label: "快捷键", icon: <Keyboard size={16} /> },
  { key: "appearance", label: "外观", icon: <Palette size={16} /> },
  { key: "tts", label: "语音", icon: <Volume2 size={16} /> },
  { key: "debug", label: "调试", icon: <Bug size={16} /> },
  { key: "exit", label: "退出程序", icon: <LogOut size={16} /> },
];

export default function SettingsDialog({ onClose, defaultTab }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(defaultTab || "api");
  const settings = useConfigStore((s) => s.settings);
  const updateSettings = useConfigStore((s) => s.updateSettings);
  const updateWebDAV = useConfigStore((s) => s.updateWebDAV);

  // WebDAV state
  const [webdavUrl, setWebdavUrl] = useState(settings.webdav.url);
  const [webdavUser, setWebdavUser] = useState(settings.webdav.username);
  const [webdavPass, setWebdavPass] = useState(settings.webdav.password);
  const [webdavPath, setWebdavPath] = useState(settings.webdav.remotePath);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleWebDAVSync = async (direction: "pull" | "push") => {
    if (!webdavUrl || !webdavUser || !webdavPass) {
      setSyncStatus("❌ 请填写完整的 WebDAV 配置");
      return;
    }

    setSyncStatus("⏳ 同步中...");

    try {
      // Save WebDAV config first
      updateWebDAV({
        enabled: true,
        url: webdavUrl,
        username: webdavUser,
        password: webdavPass,
        remotePath: webdavPath,
        lastSync: Date.now(),
      });

      if (direction === "pull") {
        // Pull from WebDAV
        const url = `${webdavUrl.replace(/\/+$/, "")}/${webdavPath.replace(/^\/+/, "")}`;
        const auth = btoa(`${webdavUser}:${webdavPass}`);

        const resp = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        const data = await resp.json();
        if (data.providers) useConfigStore.setState({ providers: data.providers });
        if (data.settings) useConfigStore.setState({ settings: data.settings });
        if (data.records) useHistoryStore.setState({ records: data.records });

        setSyncStatus(`✅ 拉取成功 (${new Date().toLocaleTimeString()})`);
      } else {
        // Push to WebDAV
        const data = {
          providers: useConfigStore.getState().providers,
          settings: useConfigStore.getState().settings,
          records: useHistoryStore.getState().records,
        };

        const url = `${webdavUrl.replace(/\/+$/, "")}/${webdavPath.replace(/^\/+/, "")}`;
        const auth = btoa(`${webdavUser}:${webdavPass}`);

        const resp = await fetch(url, {
          method: "PUT",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(data, null, 2),
        });

        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
        }

        setSyncStatus(`✅ 推送成功 (${new Date().toLocaleTimeString()})`);
      }
    } catch (e: any) {
      setSyncStatus(`❌ 同步失败: ${e.message}`);
    }
  };

  const handleOpenUserDir = async () => {
    try {
      const { invoke } = await import("../../services/bridge");
      await invoke("open_user_dir");
    } catch (e) {
      // silent — desktop env only
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 h-full">
      <div className="bg-lexi-card flex flex-col min-h-0 h-full">
        {/* Header */}
        <div className="flex items-center px-5 py-4">
          <h2 className="text-lg font-semibold text-lexi-text">设置</h2>
        </div>

        {/* Tabs + Content */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Tab sidebar */}
          <div className="w-44 p-3 space-y-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2.5 w-full px-3 py-2.5 rounded-lg text-sm transition-all ${
                  tab === t.key
                    ? "bg-lexi-accent/15 text-lexi-accent-hover font-medium"
                    : "text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Content — all tabs kept mounted (display:none) to preserve state */}
          <div className="flex-1 overflow-y-auto p-5">
            <div style={{ display: tab === "api" ? "block" : "none" }}>
              <ApiConfig />
            </div>

            <div style={{ display: tab === "localModel" ? "block" : "none" }}>
              <LocalModelTab />
            </div>

            <div style={{ display: tab === "webdav" ? "block" : "none" }}>
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-lexi-text">
                  WebDAV 配置同步
                </h3>
                <p className="text-sm text-lexi-text-muted">
                  将配置和翻译历史同步到 WebDAV 服务器，在多设备间保持一致。
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      WebDAV 地址
                    </label>
                    <input
                      type="text"
                      value={webdavUrl}
                      onChange={(e) => setWebdavUrl(e.target.value)}
                      placeholder="https://dav.example.com/remote.php/dav/files/user/"
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-lexi-text-muted mb-1">
                        用户名
                      </label>
                      <input
                        type="text"
                        value={webdavUser}
                        onChange={(e) => setWebdavUser(e.target.value)}
                        className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-lexi-text-muted mb-1">
                        密码
                      </label>
                      <input
                        type="password"
                        value={webdavPass}
                        onChange={(e) => setWebdavPass(e.target.value)}
                        className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      远程文件路径
                    </label>
                    <input
                      type="text"
                      value={webdavPath}
                      onChange={(e) => setWebdavPath(e.target.value)}
                      placeholder="/lexi/config.json"
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={() => handleWebDAVSync("pull")}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-lexi-accent/20 hover:bg-lexi-accent/30 text-lexi-accent-hover text-sm font-medium transition-all"
                  >
                    <Download size={15} />
                    <span>从服务器拉取</span>
                  </button>
                  <button
                    onClick={() => handleWebDAVSync("push")}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-500/10 hover:bg-green-500/20 text-green-400 text-sm font-medium transition-all"
                  >
                    <Upload size={15} />
                    <span>推送到服务器</span>
                  </button>
                </div>

                {syncStatus && (
                  <div
                    className={`p-3 rounded-lg text-sm animate-fade-in ${
                      syncStatus.startsWith("✅")
                        ? "bg-green-500/10 text-green-400"
                        : syncStatus.startsWith("❌")
                          ? "bg-red-500/10 text-red-400"
                          : "bg-yellow-500/10 text-yellow-400"
                    }`}
                  >
                    {syncStatus}
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: tab === "shortcut" ? "block" : "none" }}>
              <ShortcutTab
                modifiers={settings.shortcutModifiers}
                keyCode={settings.shortcutKey}
                onSave={(modifiers, keyCode) => {
                  updateSettings({ shortcutModifiers: modifiers, shortcutKey: keyCode });
                }}
              />
            </div>

            <div style={{ display: tab === "appearance" ? "block" : "none" }}>
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-lexi-text">
                  外观设置
                </h3>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      主题
                    </label>
                    <select
                      value={settings.theme}
                      onChange={(e) =>
                        updateSettings({
                          theme: e.target.value as "dark" | "light",
                        })
                      }
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    >
                      <option value="dark">深色</option>
                      <option value="light">月光白</option>
                      <option value="geek">暗夜紫</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      字号
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min="12"
                        max="20"
                        step="1"
                        value={settings.fontSize}
                        onChange={(e) =>
                          updateSettings({ fontSize: Number(e.target.value) })
                        }
                        className="flex-1 accent-lexi-accent cursor-pointer"
                      />
                      <span className="text-sm text-lexi-text font-mono min-w-[3ch] text-right">
                        {settings.fontSize}px
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      字体
                    </label>
                    <select
                      value={settings.fontFamily || "Inter"}
                      onChange={(e) => updateSettings({ fontFamily: e.target.value })}
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    >
                      <option value="Inter">Inter (默认)</option>
                      <option value="Noto Sans SC">Noto Sans SC (思源黑体)</option>
                      <option value="LXGW WenKai">LXGW WenKai (霞鹜文楷)</option>
                      <option value="Microsoft YaHei">微软雅黑</option>
                      <option value="Source Han Serif SC">Source Han Serif (思源宋体)</option>
                      <option value="JetBrains Mono, Inter">JetBrains Mono (等宽)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      粗细
                    </label>
                    <select
                      value={settings.fontWeight ?? 400}
                      onChange={(e) => updateSettings({ fontWeight: Number(e.target.value) })}
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    >
                      <option value={300}>300 — 细体 (Light)</option>
                      <option value={400}>400 — 常规 (Regular)</option>
                      <option value={500}>500 — 中等 (Medium)</option>
                      <option value={600}>600 — 半粗 (Semibold)</option>
                      <option value={700}>700 — 粗体 (Bold)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      行高 ({settings.lineHeight ?? 1.6})
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-lexi-text-muted w-5">1.2</span>
                      <input
                        type="range"
                        min="1.2"
                        max="2.5"
                        step="0.1"
                        value={settings.lineHeight ?? 1.6}
                        onChange={(e) => updateSettings({ lineHeight: parseFloat(e.target.value) })}
                        className="flex-1 accent-lexi-accent cursor-pointer"
                      />
                      <span className="text-[10px] text-lexi-text-muted w-5">2.5</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      字间距 ({settings.letterSpacing ?? 0}px)
                    </label>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] text-lexi-text-muted w-5">0</span>
                      <input
                        type="range"
                        min="0"
                        max="4"
                        step="0.5"
                        value={settings.letterSpacing ?? 0}
                        onChange={(e) => updateSettings({ letterSpacing: parseFloat(e.target.value) })}
                        className="flex-1 accent-lexi-accent cursor-pointer"
                      />
                      <span className="text-[10px] text-lexi-text-muted w-5">4</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm text-lexi-text">关闭时最小化到托盘</span>
                      <p className="text-xs text-lexi-text-muted mt-0.5">
                        点击关闭按钮时隐藏窗口而非退出程序
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        updateSettings({ closeToTray: !settings.closeToTray })
                      }
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        settings.closeToTray
                          ? "bg-lexi-accent"
                          : "bg-lexi-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          settings.closeToTray ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-lexi-text">窗口置顶</span>
                    <button
                      onClick={() =>
                        updateSettings({ alwaysOnTop: !settings.alwaysOnTop })
                      }
                      className={`relative w-10 h-5 rounded-full transition-colors ${
                        settings.alwaysOnTop
                          ? "bg-lexi-accent"
                          : "bg-lexi-border"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                          settings.alwaysOnTop ? "left-5" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Input position */}
                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      输入区位置
                    </label>
                    <select
                      value={settings.inputPosition}
                      onChange={(e) =>
                        updateSettings({
                          inputPosition: e.target.value as "top" | "bottom",
                        })
                      }
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    >
                      <option value="top">上方</option>
                      <option value="bottom">下方</option>
                    </select>
                  </div>

                  {/* Card display mode */}
                  <div>
                    <label className="block text-xs text-lexi-text-muted mb-1">
                      卡片显示
                    </label>
                    <select
                      value={settings.cardDisplay}
                      onChange={(e) =>
                        updateSettings({
                          cardDisplay: e.target.value as "flat" | "accordion" | "tabs" | "split",
                        })
                      }
                      className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                    >
                      <option value="flat">平铺展开</option>
                      <option value="accordion">手风琴折叠</option>
                      <option value="tabs">Tab 切换</option>
                      <option value="split">均分视图</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: tab === "bergamot" ? "block" : "none" }}>
              <BergamotTab />
            </div>

            <div style={{ display: tab === "tts" ? "block" : "none" }}>
              <TTSTab />
            </div>

            <div style={{ display: tab === "debug" ? "block" : "none" }}>
              <DebugTab />
            </div>

            <div style={{ display: tab === "exit" ? "block" : "none" }}>
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-lexi-text">
                  退出程序
                </h3>
                <p className="text-sm text-lexi-text-muted">
                  点击下方按钮将彻底退出龙腾翻译。所有未保存的数据将自动保存。
                </p>
                <button
                  onClick={async () => {
                    try {
                      const { invoke } = await import("../../services/bridge");
                      await invoke("app_quit");
                    } catch {
                      // fallback: close window
                      try {
                        const { getCurrentWindow } = await import("../../services/bridge");
                        await getCurrentWindow().close();
                      } catch {
                        window.close();
                      }
                    }
                  }}
                  className="flex items-center gap-2 px-6 py-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-all border border-red-500/20 hover:border-red-500/40"
                >
                  <LogOut size={16} />
                  <span>退出程序</span>
                </button>
                <p className="text-xs text-lexi-text-muted">
                  也可以右键系统托盘图标选择"退出"来关闭程序。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Config file location footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-lexi-border">
          <span className="text-xs text-lexi-text-muted">
            配置文件: config.json (应用目录)
          </span>
          <button
            onClick={handleOpenUserDir}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-lexi-accent-hover hover:bg-lexi-accent/10 transition-colors"
          >
            <FolderOpen size={13} />
            <span>打开配置目录</span>
          </button>
        </div>
      </div>
    </div>
  );
}
