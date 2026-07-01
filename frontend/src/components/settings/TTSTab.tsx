import { useState, useEffect, useCallback } from "react";
import {
  Download,
  FolderOpen,
  RefreshCw,
  Check,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TtsVoiceInfo {
  name: string;
  lang: string;
  quality: string;
  size_mb: number;
  sample_rate: number;
}

const AVAILABLE_VOICES: {
  lang: string;
  label: string;
  voice: string;
  quality: string;
  url_path: string;
}[] = [
  { lang: "zh_CN", label: "中文 (女声 huayan)", voice: "huayan", quality: "medium", url_path: "zh/zh_CN/huayan/medium/zh_CN-huayan-medium" },
  { lang: "zh_CN", label: "中文 (女声 huayan Low)", voice: "huayan", quality: "low", url_path: "zh/zh_CN/huayan/low/zh_CN-huayan-low" },
  { lang: "en_US", label: "英语 (女声 lessac)", voice: "lessac", quality: "medium", url_path: "en/en_US/lessac/medium/en_US-lessac-medium" },
  { lang: "en_US", label: "英语 (男声 ryan)", voice: "ryan", quality: "medium", url_path: "en/en_US/ryan/medium/en_US-ryan-medium" },
  { lang: "en_US", label: "英语 (女声 amy)", voice: "amy", quality: "medium", url_path: "en/en_US/amy/medium/en_US-amy-medium" },
  { lang: "fr_FR", label: "Français (gilles)", voice: "gilles", quality: "low", url_path: "fr/fr_FR/gilles/low/fr_FR-gilles-low" },
  { lang: "de_DE", label: "Deutsch (thorsten)", voice: "thorsten", quality: "medium", url_path: "de/de_DE/thorsten/medium/de_DE-thorsten-medium" },
  { lang: "es_ES", label: "Español (carlfm)", voice: "carlfm", quality: "x_low", url_path: "es/es_ES/carlfm/x_low/es_ES-carlfm-x_low" },
];

const BASE_URLS = [
  { label: "HuggingFace", base: "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0" },
  { label: "hf-mirror.com (国内镜像)", base: "https://hf-mirror.com/rhasspy/piper-voices/resolve/v1.0.0" },
];

// Map our app lang codes to Piper lang codes
const LANG_TO_PIPER: Record<string, string> = {
  zh: "zh_CN", en: "en_US",
  fr: "fr_FR", de: "de_DE", es: "es_ES", ru: "ru_RU",
  pt: "pt_BR", ar: "ar_SA", th: "th_TH", vi: "vi_VN",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isTauriEnv(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function fmtMB(mb: number): string {
  if (mb < 0.01) return "-";
  return `${mb.toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TTSTab() {
  const settings = useConfigStore((s) => s.settings);
  const updateSettings = useConfigStore((s) => s.updateSettings);

  const [voices, setVoices] = useState<TtsVoiceInfo[]>([]);
  const [voicesDir, setVoicesDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [mirrorIdx, setMirrorIdx] = useState(0);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [dlError, setDlError] = useState<string | null>(null);
  const [dlSuccess, setDlSuccess] = useState<string | null>(null);

  const isTauri = isTauriEnv();

  // ---- Refresh voice list ----
  const refreshVoices = useCallback(async () => {
    setLoading(true);
    if (isTauri) {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const list = await invoke<TtsVoiceInfo[]>("tts_get_voices");
        setVoices(list);
        const dir = await invoke<string>("tts_get_voices_dir");
        setVoicesDir(dir);
      } catch (e) {
        console.warn("[TTS] Failed to get voices:", e);
      }
    }
    setLoading(false);
  }, [isTauri]);

  useEffect(() => { refreshVoices(); }, [refreshVoices]);

  // ---- Download voice (direct to piper-voices/) ----
  const downloadVoice = async (voice: (typeof AVAILABLE_VOICES)[0]) => {
    if (!isTauri || downloading) return;
    setDownloading(voice.label);
    setDlError(null);
    setDlSuccess(null);

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const base = BASE_URLS[mirrorIdx].base;
      const voiceName = voice.url_path.split("/").pop()!;

      // Download .onnx
      await invoke("tts_download_voice", {
        url: `${base}/${voice.url_path}.onnx`,
        filename: `${voiceName}.onnx`,
      });

      // Download .onnx.json
      await invoke("tts_download_voice", {
        url: `${base}/${voice.url_path}.onnx.json`,
        filename: `${voiceName}.onnx.json`,
      });

      setDlSuccess(voice.label);
      setDownloading(null);
      refreshVoices(); // refresh list immediately
    } catch (e: any) {
      setDlError(typeof e === "string" ? e : e?.message || String(e));
      setDownloading(null);
    }
  };

  // ---- Delete voice ----
  const deleteVoice = async (name: string) => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("tts_delete_voice", { name });
      refreshVoices();
    } catch (e) {
      console.warn("[TTS] Delete failed:", e);
    }
  };

  // ---- Open voices dir ----
  const openVoicesDir = async () => {
    if (!isTauri) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("tts_open_voices_dir");
    } catch (e) { /* silent */ }
  };

  // ---- Check if a voice is installed ----
  const isVoiceInstalled = (voice: (typeof AVAILABLE_VOICES)[0]) => {
    const name = voice.url_path.split("/").pop()!;
    return voices.some((v) => v.name === name);
  };

  // ---- Voice selection per app lang ----
  const appLangs = ["zh", "en", "ja", "ko", "fr", "de", "es"];
  const getVoicesForLang = (appLang: string) => {
    const piperLang = LANG_TO_PIPER[appLang] || appLang;
    return voices.filter((v) => v.lang === piperLang || v.lang.startsWith(appLang));
  };

  const selectedVoice = (appLang: string) => settings.ttsVoice?.[appLang] || "";

  const setVoiceForLang = (appLang: string, voiceName: string) => {
    updateSettings({
      ttsVoice: { ...(settings.ttsVoice || {}), [appLang]: voiceName },
    });
  };

  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-lexi-text">语音朗读 (Piper TTS)</h3>
      <p className="text-sm text-lexi-text-muted">
        使用 Piper 神经网络语音合成引擎，离线可用，音质自然。
      </p>

      {/* Browser mode notice */}
      {!isTauri && (
        <div className="p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/15 text-sm text-yellow-400/80">
          语音模型管理仅在桌面应用中可用。当前使用浏览器内置语音引擎。
        </div>
      )}

      {/* ---- Playback settings ---- */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-lexi-text-muted mb-1">
            语速 ({settings.ttsRate.toFixed(1)}x)
          </label>
          <div className="flex items-center gap-3">
            <span className="text-xs text-lexi-text-muted">慢</span>
            <input type="range" min="0.3" max="2.0" step="0.1"
              value={settings.ttsRate}
              onChange={(e) => updateSettings({ ttsRate: parseFloat(e.target.value) })}
              className="flex-1 accent-lexi-accent cursor-pointer" />
            <span className="text-xs text-lexi-text-muted">快</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <span className="text-sm text-lexi-text">自动朗读译文</span>
            <p className="text-xs text-lexi-text-muted mt-0.5">翻译完成后自动朗读译文</p>
          </div>
          <button
            onClick={() => updateSettings({ ttsAutoRead: !settings.ttsAutoRead })}
            className={`relative w-10 h-5 rounded-full transition-colors ${settings.ttsAutoRead ? "bg-lexi-accent" : "bg-lexi-border"}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${settings.ttsAutoRead ? "left-5" : "left-0.5"}`} />
          </button>
        </div>
      </div>

      {/* ---- Voice selection per language ---- */}
      {isTauri && voices.length > 0 && (
        <div className="border-t border-lexi-border pt-4 space-y-3">
          <h4 className="text-sm font-medium text-lexi-text">语音选择</h4>
          <p className="text-xs text-lexi-text-muted">为每种语言选择默认朗读语音</p>
          {appLangs.map((appLang) => {
            const langVoices = getVoicesForLang(appLang);
            if (langVoices.length === 0) return null;
            return (
              <div key={appLang} className="flex items-center gap-3">
                <span className="text-xs text-lexi-text w-16 flex-shrink-0">
                  {appLang === "zh" ? "中文" : appLang === "en" ? "English" : appLang}
                </span>
                <select
                  value={selectedVoice(appLang)}
                  onChange={(e) => setVoiceForLang(appLang, e.target.value)}
                  className="flex-1 bg-lexi-input text-lexi-text border border-lexi-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                >
                  <option value="">自动选择</option>
                  {langVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.quality}, {v.sample_rate}Hz)
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      {/* ---- Voice model management ---- */}
      {isTauri && (
        <div className="border-t border-lexi-border pt-4">
          <h4 className="text-sm font-medium text-lexi-text mb-3">语音模型管理</h4>

          {/* Mirror selector */}
          <div className="flex items-center gap-3 mb-3">
            <span className="text-xs text-lexi-text-muted">下载源:</span>
            <select value={mirrorIdx} onChange={(e) => setMirrorIdx(Number(e.target.value))}
              className="bg-lexi-input text-lexi-text border border-lexi-border rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-lexi-accent">
              {BASE_URLS.map((b, i) => (
                <option key={i} value={i}>{b.label}</option>
              ))}
            </select>
            <button onClick={refreshVoices}
              className="p-1.5 rounded hover:bg-lexi-hover text-lexi-text-muted hover:text-lexi-text transition-colors" title="刷新">
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Status messages */}
          {dlSuccess && (
            <div className="p-2 mb-3 rounded-lg bg-green-500/10 text-green-400 text-xs flex items-center gap-1.5">
              <Check size={12} /> 已安装: {dlSuccess}
            </div>
          )}
          {dlError && (
            <div className="p-2 mb-3 rounded-lg bg-red-500/10 text-red-400 text-xs flex items-center gap-1.5">
              <AlertTriangle size={12} /> {dlError}
            </div>
          )}

          {/* Installed voices */}
          <div className="mb-2"><span className="text-xs text-lexi-text-muted">已安装 ({voices.length})</span></div>
          <div className="space-y-1 max-h-32 overflow-y-auto mb-4">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-lexi-text-muted py-2">
                <Loader2 size={12} className="animate-spin" /> 扫描中...
              </div>
            ) : voices.length === 0 ? (
              <p className="text-xs text-lexi-text-muted/60 py-2">
                未检测到语音模型。点击下方下载。
              </p>
            ) : (
              voices.map((v) => (
                <div key={v.name} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-lexi-bg/30 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-lexi-text truncate">{v.name}</span>
                    <span className="text-lexi-text-muted/50 flex-shrink-0">{v.lang} · {v.quality}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                    <span className="text-lexi-text-muted">{fmtMB(v.size_mb)}</span>
                    <button onClick={() => deleteVoice(v.name)}
                      className="p-0.5 rounded hover:bg-red-500/10 text-lexi-text-muted hover:text-red-400 transition-colors" title="删除">
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Available for download */}
          <div className="mb-2"><span className="text-xs text-lexi-text-muted">可下载</span></div>
          <div className="space-y-1 max-h-48 overflow-y-auto mb-4">
            {AVAILABLE_VOICES.map((v) => {
              const installed = isVoiceInstalled(v);
              const isDownloading = downloading === v.label;
              return (
                <div key={v.url_path} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-lexi-bg/30 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    {installed ? <Check size={12} className="text-green-400 flex-shrink-0" />
                      : <Download size={12} className="text-lexi-text-muted flex-shrink-0" />}
                    <span className={`truncate ${installed ? "text-lexi-text-muted" : "text-lexi-text"}`}>{v.label}</span>
                  </div>
                  <button
                    onClick={() => downloadVoice(v)}
                    disabled={installed || !!downloading}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex-shrink-0 ml-2 ${installed ? "text-green-400/50 cursor-default"
                      : isDownloading ? "text-lexi-accent bg-lexi-accent/10" : "text-lexi-accent-hover hover:bg-lexi-accent/10"}`}
                  >
                    {installed ? "已安装" : isDownloading ? <Loader2 size={10} className="animate-spin" /> : "下载"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Open directory */}
          <button onClick={openVoicesDir}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-lexi-accent-hover hover:bg-lexi-accent/10 transition-colors w-full justify-center">
            <FolderOpen size={13} />
            <span>打开语音模型目录 ({voicesDir || "./piper-voices/"})</span>
          </button>
        </div>
      )}
    </div>
  );
}
