// ============== LLM Provider ==============
export interface LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  isDefault: boolean;
  createdAt: number;
  // --- Advanced parameters ---
  activeModel?: string;                         // selected model from models[] for translation
  temperature?: number;                         // 0–2, default 0.7
  maxTokens?: number;                           // max output tokens, default 4096
  reasoningEffort?: "low" | "medium" | "high";  // DeepSeek/Claude/OpenAI o-series
}

// ============== Translation Record (deprecated) ==============
/** @deprecated Use TranslationSession instead. Kept for migration from old config format. */
export interface TranslationRecord {
  id: string;
  sourceText: string;
  translatedText: string; // Markdown
  sourceLang: string;
  targetLang: string;
  providerName: string;
  model: string;
  latency: number; // ms
  timestamp: number;
  isFavorite: boolean;
}

// ============== Translation Session (new history model) ==============

export interface TranslationResult {
  providerName: string;
  providerId: string;
  model: string;
  translatedText: string; // Markdown
  latency: number; // ms
}

export interface TranslationSession {
  id: string;
  sourceText: string;
  sourceLang: string;
  targetLang: string;
  timestamp: number;
  isFavorite: boolean;
  note?: string;
  tags?: string[];
  results: TranslationResult[];
}

export interface HistoryExport {
  version: 1;
  exportedAt: number;
  sessions: TranslationSession[];
}

// ============== App Settings ==============
export interface AppSettings {
  // Global shortcut
  shortcutModifiers: string[];
  shortcutKey: string;
  // Window
  alwaysOnTop: boolean;
  // WebDAV sync
  webdav: WebDAVConfig;
  // Theme
  theme: "dark" | "light" | "geek";
  fontSize: number; // px
  fontFamily?: string; // CSS font-family, default "Inter"
  fontWeight?: number; // 300–700, default 400
  lineHeight?: number; // 1.2–2.5, default 1.6
  letterSpacing?: number; // 0–4 px, default 0
  // Layout
  inputPosition: "top" | "bottom";
  cardDisplay: "flat" | "accordion" | "tabs" | "split";
  // Tray
  closeToTray: boolean;
  // TTS
  ttsRate: number;
  ttsAutoRead: boolean;
  ttsVoice: Record<string, string>; // lang -> voice_name override
  // Logging
  logLevel: "debug" | "info" | "warn" | "error";
  // Bergamot offline translation
  bergamot: BergamotConfig;
  // Polish agents (LLM polishing on top of Bergamot)
  polishStyles: PolishAgent[];
  activeStyleId: string | null;
  // Local model (llamafile)
  localModel: LocalModelConfig;
}

export interface LocalModelConfig {
  enabled: boolean;      // auto-start on launch
  port: number;          // llama.cpp API port
  activeModel: string;   // filename of active GGUF (e.g. "qwen3-0.6b-q4_k_m.gguf")
  customModels: { name: string; url: string }[];  // user-added models
}

export interface GgufModelInfo {
  name: string;
  size_bytes: number;
}

export interface PolishAgent {
  id: string;
  name: string;
  icon: string;
  prompt: string; // 完整提示词模板。空 = 仅 Bergamot
  temperature: number;
  maxTokens: number;
  providerIds?: string[]; // 未设 = 全部 provider；显式指定则仅使用列表中的 provider
}

export interface CuratedModel {
  id: string;
  name: string;
  description: string;
  size_mb: number;
  repo: string;
  filename: string;
  url_path: string;
}

export interface BergamotConfig {
  beamSize: number;   // 1-8, beam search width. Higher = better quality, slower
  cacheSize: number;  // 0-65536, translation cache. Sped up repeated translations
  direction: "auto" | "enzh" | "zhen";  // auto-detect / en→zh / zh→en
}

export interface WebDAVConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  remotePath: string;
  syncOnStart: boolean;
  lastSync: number | null;
}

// ============== API Test Result ==============
export interface ApiTestResult {
  success: boolean;
  latency: number;
  model: string;
  error?: string;
}

// ============== Defaults ==============
// ===== Defaults (single source: user/default-config.json) =====
// These are minimal placeholders — real defaults come from:
//   Desktop: get_default_config() → embedded user/default-config.json
//   Browser: fetch('/default-config.json') → Vite-served user/default-config.json

export const DEFAULT_PROVIDER: LLMProvider = {
  id: "default",
  name: "",
  baseUrl: "",
  apiKey: "",
  models: [],
  isDefault: true,
  createdAt: Date.now(),
};

export const DEFAULT_SETTINGS: AppSettings = {
  shortcutModifiers: ["Ctrl", "Alt"],
  shortcutKey: "X",
  alwaysOnTop: false,
  webdav: {
    enabled: false,
    url: "",
    username: "",
    password: "",
    remotePath: "/dragon-translator-config.json",
    syncOnStart: false,
    lastSync: null,
  },
  theme: "dark",
  fontSize: 14,
  fontFamily: "Inter",
  fontWeight: 400,
  lineHeight: 1.6,
  letterSpacing: 0,
  inputPosition: "top",
  cardDisplay: "flat",
  closeToTray: true,
  ttsRate: 1.0,
  ttsAutoRead: false,
  ttsVoice: {},
  logLevel: "info",
  bergamot: {
    beamSize: 1,
    cacheSize: 0,
    direction: "auto",
  },
  polishStyles: [],
  activeStyleId: null,
  localModel: {
    enabled: true,
    port: 5158,
    activeModel: "",
    customModels: [],
  },
};
