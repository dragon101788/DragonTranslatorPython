import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Play, Square, RefreshCw, Download, Trash2, Check, Plus,
  X, Loader2, FolderOpen, Cpu,
} from "lucide-react";
import { useConfigStore } from "../../stores/configStore";
import type { GgufModelInfo, CuratedModel } from "../../types";

// ---- Types ----

interface LocalModelStatus {
  running: boolean;
  port: number;
  model: string;
  llamafile: string;
}

// ---- Runtime-loaded model catalog ----

type MirrorEntry = { label: string; base: string };

interface ModelsCatalog {
  mirrors: MirrorEntry[];
  models: CuratedModel[];
}

const FALLBACK_CATALOG: ModelsCatalog = {
  mirrors: [
    { label: "HuggingFace", base: "https://huggingface.co" },
    { label: "hf-mirror.com (国内镜像)", base: "https://hf-mirror.com" },
  ],
  models: [
    {
      id: "hy-mt1.5-1.8b", name: "HY-MT1.5 1.8B (Q4_K_M) ⭐",
      description: "腾讯翻译专用模型，33语言+5方言", size_mb: 1000,
      repo: "tencent/HY-MT1.5-1.8B-GGUF", filename: "HY-MT1.5-1.8B-Q4_K_M.gguf", url_path: "HY-MT1.5-1.8B-Q4_K_M.gguf",
    },
    {
      id: "qwen3-0.6b", name: "Qwen3 0.6B (Q4_K_M)",
      description: "阿里 Qwen3，超轻量极速", size_mb: 480,
      repo: "bartowski/Qwen_Qwen3-0.6B-GGUF", filename: "Qwen_Qwen3-0.6B-Q4_K_M.gguf", url_path: "Qwen_Qwen3-0.6B-Q4_K_M.gguf",
    },
  ],
};

async function loadCatalog(): Promise<ModelsCatalog> {
  try {
    const resp = await fetch("/llama-config.json");
    if (resp.ok) return await resp.json();
  } catch { /* fall through to fallback */ }
  return FALLBACK_CATALOG;
}

// ---- Helpers ----

function formatSize(sizeBytes: number): string {
  if (sizeBytes >= 1e9) return `${(sizeBytes / 1e9).toFixed(1)} GB`;
  if (sizeBytes >= 1e6) return `${(sizeBytes / 1e6).toFixed(0)} MB`;
  if (sizeBytes >= 1e3) return `${(sizeBytes / 1e3).toFixed(0)} KB`;
  return `${sizeBytes} B`;
}

// ---- Component ----

export default function LocalModelTab() {
  const settings = useConfigStore((s) => s.settings);
  const updateSettings = useConfigStore((s) => s.updateSettings);

  // ---- State ----
  const [status, setStatus] = useState<LocalModelStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [diagResult, setDiagResult] = useState<Record<string, any> | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const [downloadedModels, setDownloadedModels] = useState<GgufModelInfo[]>([]);
  const [downloading, setDownloading] = useState<Record<string, boolean>>({});
  const [dlError, setDlError] = useState<string | null>(null);
  const [dlSuccess, setDlSuccess] = useState<string | null>(null);
  const [mirrorIdx, setMirrorIdx] = useState(0);
  const [progressMap, setProgressMap] = useState<Record<string, { downloaded: number; total: number }>>({});

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customName, setCustomName] = useState("");

  const customFilename = useMemo(() => {
    const name = customName.trim();
    if (!name) return "";
    return name.endsWith(".gguf") ? name : name + ".gguf";
  }, [customName]);

  // ---- Load catalog from runtime -----
  const [catalog, setCatalog] = useState<ModelsCatalog>(FALLBACK_CATALOG);
  useEffect(() => {
    loadCatalog().then(setCatalog);
  }, []);

  const mirrors = catalog.mirrors;
  const availableModels = catalog.models;

  // ---- Progress event listeners ----
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;
    import("../../services/bridge").then(({ listen }) => {
      listen<{ filename: string; downloaded: number; total: number }>(
        "model_download_progress",
        (e) => {
          setProgressMap((prev) => ({
            ...prev,
            [e.payload.filename]: { downloaded: e.payload.downloaded, total: e.payload.total },
          }));
        }
      ).then((fn) => { unlistenProgress = fn; });
      listen<{ filename: string; size_bytes: number }>(
        "model_download_complete",
        (e) => {
          const filename = e.payload.filename;
          setDownloading((prev) => {
            const next = { ...prev };
            delete next[filename];
            return next;
          });
          setProgressMap((prev) => {
            const next = { ...prev };
            delete next[filename];
            return next;
          });
          setDlSuccess(`已安装: ${filename}`);
          setTimeout(() => setDlSuccess(null), 5000);
          refreshModels();
          if (!settings.localModel.activeModel) {
            updateSettings({
              localModel: { ...settings.localModel, activeModel: filename },
            });
          }
        }
      ).then((fn) => { unlistenComplete = fn; });
    });
    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };
  }, []); // eslint-disable-line

  // ---- Refresh models ----
  const refreshModels = useCallback(async () => {
    try {
      const { invoke } = await import("../../services/bridge");
      const list = await invoke<GgufModelInfo[]>("list_downloaded_models");
      setDownloadedModels(list);
    } catch { /* ignore */ }
  }, []);

  // ---- Poll status ----
  useEffect(() => {
    refreshModels();
    const poll = async () => {
      try {
        const { invoke } = await import("../../services/bridge");
        const s = await invoke<LocalModelStatus>("get_local_model_status", {
          port: settings.localModel.port,
          model: settings.localModel.activeModel,
        });
        setStatus(s);
      } catch { /* ignore */ }
    };
    poll();
    const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, [settings.localModel.port, settings.localModel.activeModel, refreshModels]);

  // ---- Start ----
  const handleStart = async () => {
    setLoading(true);
    setMessage(null);
    const model = useConfigStore.getState().settings.localModel.activeModel;
    if (!model) {
      setMessage("请先下载并选择一个模型");
      setIsError(true);
      setLoading(false);
      return;
    }
    try {
      const { invoke } = await import("../../services/bridge");
      const msg = await invoke<string>("start_local_model", {
        port: settings.localModel.port,
        model,
      });
      setMessage(msg);
      setIsError(false);
      // Register local provider
      const localUrl = `http://127.0.0.1:${settings.localModel.port}/v1`;
      const state = useConfigStore.getState();
      const existing = state.providers.find((p) => p.id === "local");
      if (existing) {
        state.updateProvider("local", { baseUrl: localUrl, apiKey: "local" });
      } else {
        state.addProvider({
          id: "local",
          name: `本地模型 (${model.replace(".gguf", "")})`,
          baseUrl: localUrl,
          apiKey: "local",
          models: [],
          isDefault: false,
          createdAt: Date.now(),
        });
      }
      if (state.providers.length === 1) state.setActiveProvider("local");
      // Fetch model list
      try {
        const { LLMAdapter } = await import("../../services/llm/adapter");
        const adapter = new LLMAdapter({
          id: "local", name: "本地模型", baseUrl: localUrl, apiKey: "local",
          models: [], isDefault: false, createdAt: Date.now(),
        });
        const models = await adapter.fetchModels();
        if (models.length > 0) state.updateProvider("local", { models });
      } catch { /* non-fatal */ }
      refreshModels();
      const { invoke: inv } = await import("../../services/bridge");
      const s = await inv<LocalModelStatus>("get_local_model_status", {
        port: settings.localModel.port,
        model: settings.localModel.activeModel,
      });
      setStatus(s);
    } catch (e: any) {
      setMessage(e?.message || String(e));
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  // ---- Stop ----
  const handleStop = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const { invoke } = await import("../../services/bridge");
      const msg = await invoke<string>("stop_local_model");
      setMessage(msg);
      setIsError(false);
      // Remove local provider from API list
      useConfigStore.getState().deleteProvider("local");
      refreshModels();
      const { invoke: inv } = await import("../../services/bridge");
      const s = await inv<LocalModelStatus>("get_local_model_status", {
        port: settings.localModel.port,
        model: settings.localModel.activeModel,
      });
      setStatus(s);
    } catch (e: any) {
      setMessage(e?.message || String(e));
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  // ---- Diagnose ----
  const handleDiagnose = async () => {
    setDiagLoading(true);
    setDiagResult(null);
    try {
      const { invoke } = await import("../../services/bridge");
      const result = await invoke<Record<string, any>>("diagnose_environment", {
        model: settings.localModel.activeModel || undefined,
      });
      setDiagResult(result);
    } catch (e: any) {
      setDiagResult({ error: e?.message || String(e) });
    } finally {
      setDiagLoading(false);
    }
  };

  // ---- Download ----
  const downloadModel = async (model: CuratedModel) => {
    setDownloading((prev) => ({ ...prev, [model.filename]: true }));
    setDlError(null);
    setDlSuccess(null);
    setProgressMap((prev) => {
      const next = { ...prev };
      delete next[model.filename];
      return next;
    });
    try {
      const base = mirrors[mirrorIdx]?.base || mirrors[0].base;
      const url = `${base}/${model.repo}/resolve/main/${model.url_path}`;
      const { invoke } = await import("../../services/bridge");
      await invoke<string>("download_model", { url, filename: model.filename });
    } catch (e: any) {
      setDlError(e?.message || String(e));
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[model.filename];
        return next;
      });
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[model.filename];
        return next;
      });
    }
  };

  const downloadCustomModel = async () => {
    if (!customUrl.trim() || !customName.trim()) return;
    let filename = customName.trim();
    if (!filename.endsWith(".gguf")) filename += ".gguf";
    setDownloading((prev) => ({ ...prev, [filename]: true }));
    setDlError(null);
    setProgressMap((prev) => {
      const next = { ...prev };
      delete next[filename];
      return next;
    });
    try {
      const { invoke } = await import("../../services/bridge");
      await invoke<string>("download_model", { url: customUrl.trim(), filename });
      setShowCustomForm(false);
      setCustomUrl("");
      setCustomName("");
    } catch (e: any) {
      setDlError(e?.message || String(e));
      setDownloading((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[filename];
        return next;
      });
    }
  };

  // ---- Delete ----
  const deleteModel = async (filename: string) => {
    try {
      const { invoke } = await import("../../services/bridge");
      await invoke<string>("delete_model", { filename });
      if (settings.localModel.activeModel === filename) {
        updateSettings({
          localModel: { ...settings.localModel, activeModel: "" },
        });
      }
      refreshModels();
    } catch (e: any) {
      setDlError(e?.message || String(e));
    }
  };

  // ---- Activate ----
  const activateModel = async (filename: string) => {
    const wasRunning = status?.running && settings.localModel.activeModel !== filename;
    if (wasRunning) {
      try {
        const { invoke } = await import("../../services/bridge");
        await invoke<string>("stop_local_model");
      } catch { /* non-fatal */ }
    }
    updateSettings({
      localModel: { ...settings.localModel, activeModel: filename },
    });
    // Restart with new model if was previously running
    if (wasRunning) {
      // Small delay to let the old process fully exit
      await new Promise(r => setTimeout(r, 500));
      handleStart();
    }
  };

  // ---- Remove custom model from list ----
  const removeCustomModel = (index: number) => {
    const newList = [...settings.localModel.customModels];
    newList.splice(index, 1);
    updateSettings({ localModel: { ...settings.localModel, customModels: newList } });
  };

  // ---- Open dir ----
  const openDir = async () => {
    try {
      const { invoke } = await import("../../services/bridge");
      await invoke("open_user_dir");
    } catch { /* ignore */ }
  };

  return (
    <div className="space-y-5">
      {/* ---- Status card ---- */}
      <div className={`rounded-lg border p-4 ${status?.running ? "bg-green-500/5 border-green-500/20" : "bg-lexi-bg border-lexi-border"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${status?.running ? "bg-green-400" : "bg-lexi-text-muted"}`} />
            <div>
              <span className="text-sm font-medium text-lexi-text">
                {status?.running ? "运行中" : "已停止"}
              </span>
              {status?.running && (
                <span className="text-xs text-lexi-text-muted ml-2">
                  端口 {status.port} · {status.model || "未知模型"}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!status?.running ? (
              <button
                onClick={handleStart}
                disabled={loading || !settings.localModel.activeModel}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-xs font-medium transition-colors"
              >
                <Play size={14} /> 启动
              </button>
            ) : (
              <button
                onClick={handleStop}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/60 hover:bg-red-600 disabled:opacity-40 text-white text-xs font-medium transition-colors"
              >
                <Square size={14} /> 停止
              </button>
            )}
            {status?.running && settings.localModel.activeModel && (
              <button
                onClick={async () => { await handleStop(); setTimeout(handleStart, 500); }}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lexi-hover hover:bg-lexi-border text-lexi-text text-xs font-medium transition-colors"
              >
                <RefreshCw size={14} /> 重启
              </button>
            )}
            <button
              onClick={handleDiagnose}
              disabled={diagLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-lexi-hover hover:bg-lexi-border disabled:opacity-40 text-lexi-text text-xs font-medium transition-colors"
              title="运行环境诊断，帮助排查启动失败原因"
            >
              <FolderOpen size={14} /> 诊断
            </button>
          </div>
        </div>
        {message && (
          <div className={`mt-2 text-xs p-2 rounded whitespace-pre-wrap font-mono ${isError ? "text-red-400 bg-red-400/10" : "text-green-400 bg-green-400/10"}`}>
            {message}
          </div>
        )}
        {diagResult && (
          <div className="mt-2 text-xs p-3 rounded bg-blue-400/5 border border-blue-400/20 max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-blue-300">🔍 环境诊断结果</span>
              <button onClick={() => setDiagResult(null)} className="text-lexi-text-muted hover:text-lexi-text">
                <X size={14} />
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-blue-200/80 font-mono leading-relaxed">
              {JSON.stringify(diagResult, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* ---- Port ---- */}
      <div>
        <label className="block text-xs text-lexi-text-muted mb-1">API 端口</label>
        <input
          type="number"
          value={settings.localModel.port}
          onChange={(e) =>
            updateSettings({
              localModel: { ...settings.localModel, port: parseInt(e.target.value) || 5158 },
            })
          }
          className="w-28 bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
        />
      </div>

      {/* ---- Mirror selector ---- */}
      <div>
        <label className="block text-xs text-lexi-text-muted mb-1">下载源</label>
        <select
          value={mirrorIdx}
          onChange={(e) => setMirrorIdx(parseInt(e.target.value))}
          className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
        >
          {mirrors.map((b, i) => (
            <option key={i} value={i}>{b.label}</option>
          ))}
        </select>
      </div>

      {/* ---- Installed models ---- */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-lexi-text">
            已安装 ({downloadedModels.length})
          </h4>
          <button onClick={refreshModels} className="text-xs text-lexi-text-muted hover:text-lexi-text">
            <RefreshCw size={12} />
          </button>
        </div>
        {downloadedModels.length === 0 ? (
          <p className="text-xs text-lexi-text-muted py-3">暂无已安装的模型，从下方目录下载或手动添加</p>
        ) : (
          <div className="space-y-2">
            {downloadedModels.map((m) => {
              const isActive = settings.localModel.activeModel === m.name;
              return (
                <div
                  key={m.name}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-sm ${
                    isActive ? "bg-lexi-accent/10 border-lexi-accent/30" : "bg-lexi-input border-lexi-border"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Cpu size={14} className="text-lexi-text-muted flex-shrink-0" />
                      <span className="text-lexi-text truncate">{m.name}</span>
                      {isActive && (
                        <span className="text-xs text-lexi-accent flex-shrink-0 flex items-center gap-0.5">
                          <Check size={12} /> 已激活
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-lexi-text-muted ml-6">{formatSize(m.size_bytes)}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                    {!isActive && (
                      <button
                        onClick={() => activateModel(m.name)}
                        className="px-2 py-1 rounded text-xs text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
                      >
                        激活
                      </button>
                    )}
                    <button
                      onClick={() => deleteModel(m.name)}
                      className="p-1 rounded text-lexi-text-muted hover:text-red-400 hover:bg-red-400/10"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ---- Available models ---- */}
      <div>
        <h4 className="text-sm font-medium text-lexi-text mb-2">可下载模型</h4>
        <div className="space-y-2">
          {availableModels.map((model) => {
            const installed = downloadedModels.some((d) => d.name === model.filename);
            const isCurrentDownload = downloading[model.filename];
            const prog = progressMap[model.filename];
            return (
              <div
                key={model.id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2.5 ${
                  installed ? "bg-lexi-bg border-lexi-border opacity-60" : "bg-lexi-input border-lexi-border"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Download size={14} className={`flex-shrink-0 ${installed ? "text-green-400" : "text-lexi-text-muted"}`} />
                    <span className="text-sm text-lexi-text">{model.name}</span>
                  </div>
                  <p className="text-xs text-lexi-text-muted ml-6 mt-0.5">
                    {model.description} · ~{model.size_mb}MB
                  </p>
                  {isCurrentDownload && prog && prog.total > 0 && (
                    <div className="mt-2 ml-6">
                      <div className="h-1.5 bg-lexi-border rounded-full overflow-hidden">
                        <div
                          className="h-full bg-lexi-accent rounded-full transition-all duration-300"
                          style={{ width: `${Math.round((prog.downloaded / prog.total) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-lexi-text-muted mt-0.5">
                        {formatSize(prog.downloaded)} / {formatSize(prog.total)} ({Math.round((prog.downloaded / prog.total) * 100)}%)
                      </span>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => downloadModel(model)}
                  disabled={installed || isCurrentDownload}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-lexi-accent hover:bg-lexi-accent-hover disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex-shrink-0 ml-3"
                >
                  {isCurrentDownload ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> 下载中
                    </>
                  ) : installed ? (
                    <>
                      <Check size={14} /> 已安装
                    </>
                  ) : (
                    <>
                      <Download size={14} /> 下载
                    </>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ---- Custom models ---- */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-lexi-text">
            自定义模型 ({settings.localModel.customModels.length})
          </h4>
          <button
            onClick={() => setShowCustomForm(!showCustomForm)}
            className="flex items-center gap-1 text-xs text-lexi-text-muted hover:text-lexi-text"
          >
            <Plus size={14} /> 添加
          </button>
        </div>

        {showCustomForm && (
          <div className="rounded-lg border border-lexi-border bg-lexi-input p-3 mb-2 space-y-2">
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="模型名称 (如 qwen3-0.6b.gguf)"
              className="w-full bg-lexi-bg border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
            />
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="下载 URL (HuggingFace 直链)"
              className="w-full bg-lexi-bg border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={downloadCustomModel}
                disabled={!customUrl.trim() || !customName.trim()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-lexi-accent hover:bg-lexi-accent-hover disabled:opacity-40 text-white text-xs"
              >
                {downloading[customFilename] ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                下载
              </button>
              <button
                onClick={() => { setShowCustomForm(false); setCustomUrl(""); setCustomName(""); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg hover:bg-lexi-hover text-lexi-text-muted text-xs"
              >
                <X size={14} /> 取消
              </button>
            </div>
          </div>
        )}

        {settings.localModel.customModels.length > 0 ? (
          <div className="space-y-2">
            {settings.localModel.customModels.map((cm, i) => {
              const installed = downloadedModels.some(
                (d) => d.name === cm.name || d.name === cm.name + ".gguf"
              );
              return (
                <div key={i} className="flex items-center justify-between rounded-lg border border-lexi-border bg-lexi-input px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-lexi-text">{cm.name}</span>
                    <span className="text-xs text-lexi-text-muted ml-2 truncate max-w-[200px] inline-block">
                      {cm.url}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                    {!installed && (
                      <button
                        onClick={async () => {
                          const filename = cm.name.endsWith(".gguf") ? cm.name : cm.name + ".gguf";
                          setDownloading((prev) => ({ ...prev, [filename]: true }));
                          setDlError(null);
                          setProgressMap((prev) => {
                            const next = { ...prev };
                            delete next[filename];
                            return next;
                          });
                          try {
                            const { invoke } = await import("../../services/bridge");
                            await invoke<string>("download_model", { url: cm.url, filename });
                          } catch (e: any) {
                            setDlError(e?.message || String(e));
                            setDownloading((prev) => {
                              const next = { ...prev };
                              delete next[filename];
                              return next;
                            });
                            setProgressMap((prev) => {
                              const next = { ...prev };
                              delete next[filename];
                              return next;
                            });
                          }
                        }}
                        className="p-1 rounded text-lexi-text-muted hover:text-lexi-accent"
                      >
                        {downloading[cm.name.endsWith(".gguf") ? cm.name : cm.name + ".gguf"] ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Download size={14} />
                        )}
                      </button>
                    )}
                    <button onClick={() => removeCustomModel(i)} className="p-1 rounded text-lexi-text-muted hover:text-red-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-lexi-text-muted py-2">添加自定义模型 URL，直接下载到本地</p>
        )}
      </div>

      {/* ---- Download status ---- */}
      {dlError && (
        <div className="text-xs text-red-400 bg-red-400/10 rounded-lg p-3">{dlError}</div>
      )}
      {dlSuccess && (
        <div className="text-xs text-green-400 bg-green-400/10 rounded-lg p-3">{dlSuccess}</div>
      )}

      {/* ---- Open dir ---- */}
      <button
        onClick={openDir}
        className="flex items-center gap-2 text-xs text-lexi-text-muted hover:text-lexi-text transition-colors"
      >
        <FolderOpen size={14} />
        打开本地模型目录
      </button>
    </div>
  );
}
