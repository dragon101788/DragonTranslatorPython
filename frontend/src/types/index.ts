// ============== LLM Provider ==============
export interface LLMProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  isDefault: boolean;
  createdAt: number;
}

// ============== Translation Record ==============
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
  // Polish styles (LLM polishing on top of Bergamot)
  polishStyles: PolishStyle[];
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

export interface PolishStyle {
  id: string;
  name: string;
  icon: string;
  prompt: string; // 完整提示词模板。空 = 仅 Bergamot
  temperature: number;
  maxTokens: number;
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
//   Tauri:  get_default_config() → embedded user/default-config.json
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
