import { useEffect, useRef } from "react";
import { useConfigStore } from "../stores/configStore";
import { useHistoryStore } from "../stores/historyStore";
import type { Store } from "@tauri-apps/plugin-store";
import type { LLMProvider, AppSettings } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { logger } from "../services/logger";

const STORE_FILENAME = "config.json";
const LS_KEY = "dragon-translator-config";

interface PersistedData {
  providers: LLMProvider[];
  activeProviderId: string | null;
  settings: AppSettings;
  records: any[];
}

// ---- environment detection ----

function isTauriEnv(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}

// ---- gather / apply state snapshots ----

function getSnapshot(): PersistedData {
  return {
    providers: useConfigStore.getState().providers,
    activeProviderId: useConfigStore.getState().activeProviderId,
    settings: useConfigStore.getState().settings,
    records: useHistoryStore.getState().records,
  };
}

function applySnapshot(data: PersistedData) {
  if (data.providers && data.providers.length > 0) {
    // Same guard for activeProviderId
    const activeProviderId =
      data.activeProviderId != null
        ? data.activeProviderId
        : data.providers[0].id;
    useConfigStore.setState({
      providers: data.providers,
      activeProviderId,
    });
  } else if (data.providers) {
    // providers array exists but is empty — still update the list
    useConfigStore.setState({
      providers: data.providers,
    });
  }
  if (data.settings) {
    // Merge saved settings with defaults so new fields (e.g. ttsRate)
    // don't remain undefined on old configs.
    useConfigStore.setState({
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
    });
  }
  if (data.records)
    useHistoryStore.setState({ records: data.records });
}

// ---- Tauri backend (file-based) ----

let _storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!_storePromise) {
    _storePromise = (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const base = await invoke<string>("get_app_dir");
      const storePath = `${base}\\${STORE_FILENAME}`;
      logger.info(`Persistence store path: ${storePath}`);
      const { load } = await import("@tauri-apps/plugin-store");
      return load(storePath, { autoSave: true, defaults: {} });
    })().catch((e) => {
      const msg = `getStore FAILED: ${e}`;
      console.error("[Persistence]", msg);
      logger.error(msg);
      _storePromise = null;
      throw e;
    });
  }
  return _storePromise;
}

async function syncLogLevel(level?: string) {
  if (!isTauriEnv() || !level) return;
  try {
    const lvlMap: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("set_log_level", { level: lvlMap[level] ?? 1 });
  } catch (e: any) {
    logger.error(`syncLogLevel failed: ${e?.message || e}`);
  }
}

async function loadFromFile(): Promise<boolean> {
  const store = await getStore();
  const data = await store.get<PersistedData>("app");
  if (data) {
    applySnapshot(data);
    syncLogLevel(data.settings?.logLevel);
    logger.info(
      `配置从磁盘加载 (providers=${data.providers?.length ?? 0})`
    );
    return true;
  }
  logger.info("config.json 存在但无 app 数据, 将加载默认配置");
  return false;
}

async function saveToFile(data: PersistedData) {
  const store = await getStore();
  await store.set("app", data);
  await store.save();
}

// ---- Browser backend (localStorage) ----

function loadFromLocalStorage(): boolean {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw) as PersistedData;
      applySnapshot(data);
      logger.info("配置从 localStorage 加载");
      return true;
    }
  } catch (e: any) {
    logger.error(`localStorage 加载失败: ${e?.message || e}`);
  }
  return false;
}

function saveToLocalStorage(data: PersistedData) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e: any) {
    logger.error(`localStorage 写入失败: ${e?.message || e}`);
  }
}

// ---- debounced persist ----

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 50);
}

async function persistNow() {
  saveTimer = null;
  try {
    const data = getSnapshot();
    const serialized = JSON.stringify(data);
    if (serialized === lastWritten) return;
    lastWritten = serialized;

    if (isTauriEnv()) {
      await saveToFile(data);
    } else {
      saveToLocalStorage(data);
    }
  } catch (e) {
    console.error("[Persistence] ❌ Write failed:", e);
  }
}

async function loadDefaults() {
  let raw: { providers: LLMProvider[]; settings: AppSettings } | null = null;

  if (isTauriEnv()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const json = await invoke<string>("get_default_config");
      raw = JSON.parse(json);
      logger.info("默认配置从嵌入文件加载成功");
    } catch (e: any) {
      const msg = `get_default_config 失败: ${e?.message || e}`;
      console.error("[Persistence]", msg);
      logger.error(msg);
    }
  } else {
    try {
      const resp = await fetch("/default-config.json");
      raw = await resp.json();
      logger.info("默认配置从 /default-config.json 加载成功");
    } catch (e: any) {
      const msg = `Browser defaults fetch 失败: ${e?.message || e}`;
      console.error("[Persistence]", msg);
      logger.error(msg);
    }
  }

  if (!raw) return;

  const data: PersistedData = {
    ...raw,
    activeProviderId: raw.providers[0]?.id ?? null,
    records: [],
  };
  applySnapshot(data);
  logger.info(
    `默认配置已加载 (providers=${raw.providers.length})`
  );
}

async function loadPersisted() {
  if (isTauriEnv()) {
    try {
      const loaded = await loadFromFile();
      if (loaded) return;
      // No saved data → load embedded defaults
      logger.info("无已保存配置, 加载嵌入默认配置...");
      await loadDefaults();
      return;
    } catch (e: any) {
      const msg = `磁盘加载失败, 回退到默认配置: ${e?.message || e}`;
      console.error("[Persistence]", msg);
      logger.error(msg);
      // FALLBACK: even on error, try to load defaults
      try {
        await loadDefaults();
      } catch (e2: any) {
        logger.error(`默认配置回退也失败: ${e2?.message || e2}`);
      }
    }
  } else {
    const loaded = loadFromLocalStorage();
    if (!loaded) {
      logger.info("浏览器: 无已保存配置, 加载默认配置...");
      await loadDefaults();
    }
  }
}

/**
 * Hybrid persistence: Tauri file store (desktop) → localStorage fallback (browser).
 * Uses Zustand `subscribe` for reliable auto-save on every state change.
 */
export function usePersistence() {
  const readyRef = useRef(false);
  const unsubRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;

    // 1. Load saved state
    loadPersisted().then(() => {
      if (cancelled) return;
      readyRef.current = true;

      // 2. Subscribe to store changes → auto-persist
      const unsub1 = useConfigStore.subscribe(() => {
        if (readyRef.current) schedulePersist();
      });
      const unsub2 = useHistoryStore.subscribe(() => {
        if (readyRef.current) schedulePersist();
      });
      unsubRef.current = [unsub1, unsub2];
    });

    // 3. Best-effort flush before unload
    const onBeforeUnload = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        persistNow();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      cancelled = true;
      unsubRef.current.forEach((fn) => fn());
      unsubRef.current = [];
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return { loadData: loadPersisted, saveData: persistNow };
}
