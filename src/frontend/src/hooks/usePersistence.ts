import { useEffect, useRef } from "react";
import { useConfigStore } from "../stores/configStore";
import { useHistoryStore } from "../stores/historyStore";
import type { LLMProvider, AppSettings, TranslationRecord, TranslationSession } from "../types";
import { DEFAULT_SETTINGS } from "../types";
import { logger } from "../services/logger";

interface PersistedData {
  providers: LLMProvider[];
  activeProviderId: string | null;
  settings: AppSettings;
  // records removed — now stored in separate history.json
}

interface HistoryFileData {
  sessions: TranslationSession[];
}

// ---- gather / apply state snapshots (config only) ----

function getSnapshot(): PersistedData {
  return {
    providers: useConfigStore.getState().providers,
    activeProviderId: useConfigStore.getState().activeProviderId,
    settings: useConfigStore.getState().settings,
  };
}

function applySnapshot(data: PersistedData) {
  if (data.providers && data.providers.length > 0) {
    const activeProviderId =
      data.activeProviderId != null
        ? data.activeProviderId
        : data.providers[0].id;
    useConfigStore.setState({
      providers: data.providers,
      activeProviderId,
    });
  } else if (data.providers) {
    useConfigStore.setState({
      providers: data.providers,
    });
  }
  if (data.settings) {
    useConfigStore.setState({
      settings: { ...DEFAULT_SETTINGS, ...data.settings },
    });
  }
}

async function syncLogLevel(level?: string) {
  if (!level) return;
  try {
    const lvlMap: Record<string, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    const { invoke } = await import("../services/bridge");
    await invoke("set_log_level", { level: lvlMap[level] ?? 1 });
  } catch (e: any) {
    logger.error(`syncLogLevel failed: ${e?.message || e}`);
  }
}

function _diffSettings(prev: any, next: any): string[] {
  if (!prev || !next) return [];
  const changed: string[] = [];
  const flatKeys = ["theme", "fontSize", "fontFamily", "fontWeight", "lineHeight", "letterSpacing", "logLevel", "ttsRate", "inputPosition", "cardDisplay"];
  for (const k of flatKeys) {
    if (prev[k] !== next[k]) {
      changed.push(`${k}: ${JSON.stringify(prev[k])} → ${JSON.stringify(next[k])}`);
    }
  }
  const nestedKeys: Record<string, string[]> = {
    localModel: ["activeModel", "port", "enabled"],
    webdav: ["url", "enabled"],
    bergamot: ["beamSize", "direction"],
  };
  for (const [group, keys] of Object.entries(nestedKeys)) {
    if (!prev[group] || !next[group]) continue;
    for (const k of keys) {
      if (prev[group][k] !== next[group][k]) {
        changed.push(`${group}.${k}: ${JSON.stringify(prev[group][k])} → ${JSON.stringify(next[group][k])}`);
      }
    }
  }
  if (prev.shortcutModifiers?.join("+") !== next.shortcutModifiers?.join("+") || prev.shortcutKey !== next.shortcutKey) {
    changed.push(`快捷键: ${prev.shortcutModifiers?.join("+") || ""}+${prev.shortcutKey || ""} → ${next.shortcutModifiers?.join("+") || ""}+${next.shortcutKey || ""}`);
  }
  if (prev.polishStyles?.length !== next.polishStyles?.length) {
    changed.push(`润色风格: ${prev.polishStyles?.length || 0} → ${next.polishStyles?.length || 0}`);
  }
  return changed;
}

async function loadFromFile(): Promise<boolean> {
  const { invoke } = await import("../services/bridge");
  const data = await invoke<PersistedData | null>("config_get", { key: "app" });
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
  const { invoke } = await import("../services/bridge");
  await invoke("config_set", { key: "app", value: data });
  await invoke("config_save");
}

// ---- History persistence (separate file) ----

/**
 * Migrate old flat TranslationRecord[] into session-based TranslationSession[].
 * Groups records by (sourceText, timestamp) — records created in the same
 * translation action share near-identical timestamps.
 */
export function migrateOldRecords(oldRecords: TranslationRecord[]): TranslationSession[] {
  // Round timestamps to nearest second for grouping (records from same translation
  // are created within ms of each other)
  const groups = new Map<string, TranslationRecord[]>();

  for (const record of oldRecords) {
    // Group by sourceText + timestamp rounded to nearest 100ms
    const roundedTs = Math.round(record.timestamp / 100) * 100;
    const key = `${record.sourceText}|${record.sourceLang}|${record.targetLang}|${roundedTs}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(record);
  }

  const sessions: TranslationSession[] = [];
  for (const records of groups.values()) {
    const first = records[0];
    sessions.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceText: first.sourceText,
      sourceLang: first.sourceLang,
      targetLang: first.targetLang,
      timestamp: first.timestamp,
      isFavorite: records.some((r) => r.isFavorite),
      results: records.map((r) => ({
        providerName: r.providerName,
        providerId: "migrated-" + r.providerName,
        model: r.model,
        translatedText: r.translatedText,
        latency: r.latency,
      })),
    });
  }

  return sessions.sort((a, b) => b.timestamp - a.timestamp).slice(0, 1000);
}

async function loadHistoryFromFile(): Promise<boolean> {
  const { invoke } = await import("../services/bridge");
  const data = await invoke<HistoryFileData | null>("history_get", {});
  if (data && Array.isArray(data.sessions)) {
    useHistoryStore.getState().setSessions(data.sessions);
    logger.info(`历史记录从磁盘加载 (sessions=${data.sessions.length})`);
    return true;
  }
  return false;
}

async function saveHistoryToFile(sessions: TranslationSession[]) {
  const { invoke } = await import("../services/bridge");
  await invoke("history_set", { sessions });
  await invoke("history_save");
}

async function loadHistory() {
  // Try loading history.json first
  const loaded = await loadHistoryFromFile();
  if (loaded) return;

  // Try migration from old config.json records
  try {
    const { invoke } = await import("../services/bridge");
    const oldData = await invoke<{ records?: TranslationRecord[] } | null>("config_get", { key: "app" });
    if (oldData?.records && oldData.records.length > 0) {
      logger.info(`检测到旧格式记录 (${oldData.records.length}条), 开始迁移...`);
      const sessions = migrateOldRecords(oldData.records);
      if (sessions.length > 0) {
        useHistoryStore.getState().setSessions(sessions);
        await saveHistoryToFile(sessions);
        logger.info(`迁移完成: ${sessions.length} 个会话`);
      }
    }
  } catch (e: any) {
    logger.error(`历史迁移失败: ${e?.message || e}`);
  }
}

// ---- debounced persist (config) ----

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastWritten: string | null = null;

function schedulePersist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 300);
}

async function persistNow() {
  saveTimer = null;
  try {
    const data = getSnapshot();
    const serialized = JSON.stringify(data);
    if (serialized === lastWritten) return;
    lastWritten = serialized;
    await saveToFile(data);
  } catch (e) {
    console.error("[Persistence] ❌ Write failed:", e);
    logger.error(`[Persist] Write failed: ${(e as any)?.message || e}`);
  }
}

// ---- debounced persist (history) ----

let historySaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastHistoryWritten: string | null = null;

function scheduleHistoryPersist() {
  if (historySaveTimer) clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(persistHistoryNow, 300);
}

async function persistHistoryNow() {
  historySaveTimer = null;
  try {
    const sessions = useHistoryStore.getState().sessions;
    const serialized = JSON.stringify(sessions);
    if (serialized === lastHistoryWritten) return;
    lastHistoryWritten = serialized;
    await saveHistoryToFile(sessions);
  } catch (e) {
    console.error("[Persistence] ❌ History write failed:", e);
    logger.error(`[Persist] History write failed: ${(e as any)?.message || e}`);
  }
}

// ---- config load defaults ----

async function loadDefaults() {
  let raw: { providers: LLMProvider[]; settings: AppSettings } | null = null;

  try {
    const { invoke } = await import("../services/bridge");
    const json = await invoke<string>("get_default_config");
    raw = JSON.parse(json);
    logger.info("默认配置从嵌入文件加载成功");
  } catch (e: any) {
    const msg = `get_default_config 失败: ${e?.message || e}`;
    console.error("[Persistence]", msg);
    logger.error(msg);
  }

  if (!raw) return;

  const data: PersistedData = {
    ...raw,
    activeProviderId: raw.providers[0]?.id ?? null,
  };
  applySnapshot(data);
  logger.info(
    `默认配置已加载 (providers=${raw.providers.length})`
  );
}

async function loadPersisted() {
  try {
    const loaded = await loadFromFile();
    if (loaded) return;
    logger.info("无已保存配置, 加载嵌入默认配置...");
    await loadDefaults();
  } catch (e: any) {
    const msg = `磁盘加载失败, 回退到默认配置: ${e?.message || e}`;
    console.error("[Persistence]", msg);
    logger.error(msg);
    try {
      await loadDefaults();
    } catch (e2: any) {
      logger.error(`默认配置回退也失败: ${e2?.message || e2}`);
    }
  }
}

/**
 * File-based persistence via Python backend. Uses Zustand `subscribe` for auto-save.
 * Config and history are persisted separately: config.json and history.json.
 */
export function usePersistence() {
  const readyRef = useRef(false);
  const unsubRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;

    // 1. Load saved state
    loadPersisted().then(async () => {
      if (cancelled) return;

      // 2. Load history (separate file, with migration fallback)
      await loadHistory();

      readyRef.current = true;
      logger.info("[Persist] load complete, attaching subscribers");

      // 3. Subscribe to store changes → auto-persist
      const unsub1 = useConfigStore.subscribe((state: any, prev: any) => {
        if (readyRef.current) {
          const changed = _diffSettings(prev?.settings, state?.settings);
          if (changed.length > 0) {
            logger.info(`设置变更: ${changed.join(", ")}`);
          }
          schedulePersist();
        }
      });
      const unsub2 = useHistoryStore.subscribe(() => {
        if (readyRef.current) scheduleHistoryPersist();
      });
      unsubRef.current = [unsub1, unsub2];
    });

    // 4. Best-effort flush before unload
    const onBeforeUnload = () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        persistNow();
      }
      if (historySaveTimer) {
        clearTimeout(historySaveTimer);
        historySaveTimer = null;
        persistHistoryNow();
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
