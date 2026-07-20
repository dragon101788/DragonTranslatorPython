import { useState, useCallback, useEffect } from "react";
import Sidebar from "./components/layout/Sidebar";
import MainPanel from "./components/layout/MainPanel";
import TitleBar from "./components/layout/TitleBar";
import { usePersistence } from "./hooks/usePersistence";
import { useConfigStore } from "./stores/configStore";
import { logger } from "./services/logger";
type ViewType = "translation" | "history" | "settings";

function App() {
  usePersistence();

  // ---- Auto-start local model if downloaded & activated ----
  useEffect(() => {
    // auto-start / shortcut sync
    const timer = setTimeout(async () => {
      const { localModel } = useConfigStore.getState().settings;
      if (!localModel.activeModel) return;
      if (!localModel.enabled) {
        logger.info("本地模型已禁用, 跳过自动启动");
        return;
      }
      logger.info(`检测到已激活模型: ${localModel.activeModel}，自动启动...`);
      try {
        const { invoke } = await import("./services/bridge");
        const msg = await invoke<string>("start_local_model", {
          port: localModel.port,
          model: localModel.activeModel,
        });
        logger.info(`本地模型自动启动成功: ${msg}`);

        const localUrl = `http://127.0.0.1:${localModel.port}/v1`;
        const state = useConfigStore.getState();
        const existing = state.providers.find((p) => p.id === "local");
        const modelName = localModel.activeModel.replace(".gguf", "");
        if (existing) {
          state.updateProvider("local", { baseUrl: localUrl, apiKey: "local", name: `本地模型 (${modelName})` });
        } else {
          state.addProvider({
            id: "local", name: `本地模型 (${modelName})`,
            baseUrl: localUrl, apiKey: "local", models: [], isDefault: false, createdAt: Date.now(),
          });
        }
      } catch (e: any) {
        logger.warn(`本地模型自动启动失败: ${e?.message || e}`);
        // 清理旧会话遗留的本地 provider（服务未实际运行）
        const st = useConfigStore.getState();
        if (st.providers.some((p) => p.id === "local")) {
          st.deleteProvider("local");
          logger.info("已移除未运行的本地 provider");
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  // ---- Sync theme & font to <html> ----
  useEffect(() => {
    const unsub = useConfigStore.subscribe((s) => {
      document.documentElement.setAttribute("data-theme", s.settings.theme);
      document.documentElement.style.setProperty("--lexi-font-size", `${s.settings.fontSize}px`);
      document.documentElement.style.setProperty("--lexi-font-family", s.settings.fontFamily || "Inter");
      document.documentElement.style.setProperty("--lexi-font-weight", String(s.settings.fontWeight ?? 400));
      document.documentElement.style.setProperty("--lexi-line-height", String(s.settings.lineHeight ?? 1.6));
      document.documentElement.style.setProperty("--lexi-letter-spacing", `${s.settings.letterSpacing ?? 0}px`);
    });
    const s = useConfigStore.getState().settings;
    document.documentElement.setAttribute("data-theme", s.theme);
    document.documentElement.style.setProperty("--lexi-font-size", `${s.fontSize}px`);
    document.documentElement.style.setProperty("--lexi-font-family", s.fontFamily || "Inter");
    document.documentElement.style.setProperty("--lexi-font-weight", String(s.fontWeight ?? 400));
    document.documentElement.style.setProperty("--lexi-line-height", String(s.lineHeight ?? 1.6));
    document.documentElement.style.setProperty("--lexi-letter-spacing", `${s.letterSpacing ?? 0}px`);
    return unsub;
  }, []);

  // ---- Sync shortcut from settings to backend ----
  useEffect(() => {
    // auto-start / shortcut sync
    const s = useConfigStore.getState().settings;
    import("./services/bridge").then(({ invoke }) => {
      invoke("configure_shortcut", {
        modifiers: s.shortcutModifiers,
        key: s.shortcutKey,
      }).catch((e: any) => logger.error(`快捷键注册失败: ${e?.message || e}`));
    });
  }, []);

  useEffect(() => {
    // auto-start / shortcut sync
    const unsub = useConfigStore.subscribe((state, prev) => {
      const mods = state.settings.shortcutModifiers;
      const key = state.settings.shortcutKey;
      if (mods !== prev.settings.shortcutModifiers || key !== prev.settings.shortcutKey) {
        import("./services/bridge").then(({ invoke }) => {
          invoke("configure_shortcut", { modifiers: mods, key }).catch(
            (e: any) => logger.error(`快捷键更新失败: ${e?.message || e}`)
          );
        });
      }
    });
    return unsub;
  }, []);

  // ---- On first launch, fetch models for the default provider ----
  useEffect(() => {
    const provider = useConfigStore.getState().providers[0];
    if (provider && provider.models.length === 0) {
      import("./services/llm/adapter").then(({ LLMAdapter }) => {
        const adapter = new LLMAdapter(provider);
        adapter.fetchModels().then((models) => {
          if (models.length > 0) {
            useConfigStore.getState().updateProvider(provider.id, { models });
          }
        }).catch((e: any) => {
          logger.warn(`默认服务商模型列表获取失败 (${provider.name}): ${e?.message || e}`);
        });
      });
    }
  }, []);

  // ---- View management ----
  const [view, setView] = useState<ViewType>("translation");
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);

  const handleCloseRequest = useCallback(() => {
    // auto-start / shortcut sync
    const s = useConfigStore.getState().settings;
    if (s.closeToTray) {
      import("./services/bridge").then(({ getCurrentWindow }) => {
        getCurrentWindow().hide();
      });
    } else {
      import("./services/bridge").then(({ getCurrentWindow }) => {
        getCurrentWindow().close();
      });
    }
  }, []);

  const goToTranslation = useCallback(() => { setView("translation"); setEditingAgentId(null); }, []);
  const goToHistory = () => { setView("history"); setEditingAgentId(null); };
  const goToSettings = () => { setView("settings"); setEditingAgentId(null); };

  return (
    <div className="flex flex-col h-screen w-screen bg-lexi-bg overflow-hidden">
      <TitleBar
        onCloseRequest={handleCloseRequest}
        onOpenHistory={goToHistory}
        onOpenSettings={goToSettings}
        view={view}
        onBack={goToTranslation}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          activeView={view}
          onSelectTranslation={goToTranslation}
          onOpenHistory={goToHistory}
          onOpenSettings={goToSettings}
          onEditAgent={(id) => setEditingAgentId(id)}
        />
        <div className="flex-1 min-w-0">
          <MainPanel
            view={view}
            editingAgentId={editingAgentId}
            onCloseAgentEditor={() => setEditingAgentId(null)}
            onBack={goToTranslation}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
