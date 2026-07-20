import { useCallback, useEffect, useRef, useState } from "react";
import InputArea from "../translation/InputArea";
import OutputCard from "../translation/OutputCard";
import SettingsDialog from "../settings/SettingsDialog";
import AgentManager from "../settings/AgentManager";
import HistoryPanel from "./HistoryPanel";
import { useConfigStore } from "../../stores/configStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useTTS } from "../../hooks/useTTS";
import { logger } from "../../services/logger";
import type { TranslationResult } from "../../types";
import { Loader2, WifiOff } from "lucide-react";

type ViewType = "translation" | "history" | "settings";

interface CardData {
  cardId: string;
  providerId: string;
  providerName: string;
  providerIcon: string;
  model: string;
  result: string | null;
  error: string | null;
  translating: boolean;
  latency: number;
}

interface MainPanelProps {
  view: ViewType;
  editingAgentId: string | null;
  onCloseAgentEditor: () => void;
  onBack: () => void;
}

export default function MainPanel({ view, editingAgentId, onCloseAgentEditor, onBack }: MainPanelProps) {
  const settings = useConfigStore((s) => s.settings);
  const tts = useTTS();

  const activeAgent = settings.activeStyleId ? settings.polishStyles.find((s) => s.id === settings.activeStyleId) || null : null;
  const providers = useConfigStore((s) => s.providers);

  // ---- Cards state ----
  const [cards, setCards] = useState<CardData[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const abortRefs = useRef<AbortController[]>([]);

  // ---- Reuse text from history ----
  const [reuseText, setReuseText] = useState<string | null>(null);

  // ---- Session accumulation (for history) ----
  const sessionResultsRef = useRef<TranslationResult[]>([]);
  const sessionMetaRef = useRef<{ sourceText: string; sourceLang: string; targetLang: string }>({
    sourceText: "", sourceLang: "", targetLang: ""
  });

  // Copy state
  const [copyState, setCopyState] = useState<Record<string, "idle" | "copied">>({});
  // Card selection state (accordion / tabs)
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  // Auto-select latest card in accordion/tabs mode
  useEffect(() => {
    if ((settings.cardDisplay === "accordion" || settings.cardDisplay === "tabs") && cards.length > 0) {
      // Prefer the latest non-bergamot card, fallback to bergamot
      const polishCards = cards.filter((c) => c.cardId !== "bergamot");
      const latest = polishCards.length > 0 ? polishCards[polishCards.length - 1] : cards[cards.length - 1];
      setSelectedCardId(latest.cardId);
    }
  }, [cards, settings.cardDisplay]);
  const handleCopy = useCallback(async (providerId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState((prev) => ({ ...prev, [providerId]: "copied" }));
      setTimeout(() => setCopyState((prev) => ({ ...prev, [providerId]: "idle" })), 1500);
    } catch {
      const ta = document.createElement("textarea"); ta.value = text;
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
  }, []);

  // Auto-read on completion
  const prevTranslating = useRef(false);
  useEffect(() => {
    if (prevTranslating.current && !isTranslating) {
      const first = cards.find((c) => c.result);
      if (first?.result) {
        const s = useConfigStore.getState().settings;
        if (s.ttsAutoRead) tts.speak(first.result.replace(/<[^>]*>/g, ""), "");
      }
    }
    prevTranslating.current = isTranslating;
  }, [isTranslating, cards, tts]);

  // ---- Translate ----
  const handleTranslate = useCallback(async (text: string) => {
    // Read latest config on every click (not from stale render closure)
    const state = useConfigStore.getState();
    const currentProviders = state.providers;
    const currentSettings = state.settings;
    const currentActiveAgent = currentSettings.activeStyleId
      ? currentSettings.polishStyles.find((s) => s.id === currentSettings.activeStyleId) || null
      : null;

    setIsTranslating(true);
    setCards([]);

    // Stage 1: Bergamot
    const start = Date.now();
    const bergamotCard: CardData = {
      cardId: "bergamot", providerId: "bergamot", providerName: "离线翻译",
      providerIcon: "local", model: "Bergamot NMT", result: null, error: null, translating: true, latency: 0,
    };
    setCards([bergamotCard]);

    let bergamotResult = "";
    try {
      const { initBergamot, translateBergamot } = await import("../../services/bergamot");
      const ok = await initBergamot();
      if (!ok) throw new Error("Bergamot 离线翻译引擎不可用");
      bergamotResult = await translateBergamot(text);
      const elapsed = Date.now() - start;
      setCards((prev) => prev.map((c) => c.cardId === "bergamot"
        ? { ...c, result: bergamotResult, translating: false, latency: elapsed }
        : c
      ));
      logger.info(`[Bergamot] 完成 chars=${bergamotResult.length} latency=${elapsed}ms`);
      // Accumulate for session
      sessionMetaRef.current = {
        sourceText: text,
        sourceLang: /[一-鿿㐀-䶿]/.test(text) ? "中文" : "英文",
        targetLang: /[一-鿿㐀-䶿]/.test(bergamotResult) ? "中文" : "英文",
      };
      sessionResultsRef.current = [{
        providerName: "离线翻译",
        providerId: "bergamot",
        model: "Bergamot NMT",
        translatedText: bergamotResult,
        latency: elapsed,
      }];
    } catch (e: any) {
      setCards((prev) => prev.map((c) => c.cardId === "bergamot"
        ? { ...c, error: e?.message || "翻译失败", translating: false }
        : c
      ));
      logger.warn(`[Bergamot] 错误: ${e?.message || e}`);
      setIsTranslating(false);
      return;
    }

    // Stage 2: LLM polish — all providers in parallel
    const hasLLM = !!(currentActiveAgent?.prompt && currentProviders.length > 0);
    if (!hasLLM) {
      // Commit Bergamot-only session
      if (sessionMetaRef.current.sourceText) {
        useHistoryStore.getState().addSession({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ...sessionMetaRef.current,
          timestamp: Date.now(),
          isFavorite: false,
          results: sessionResultsRef.current,
        });
      }
      setIsTranslating(false);
      return;
    }

    const targetLang = /[一-鿿㐀-䶿]/.test(bergamotResult) ? "中文" : "英文";
    const userMsg = (currentActiveAgent?.prompt || "")
      .replace("{source}", text)
      .replace("{bergamot}", bergamotResult)
      .replace("{targetLang}", targetLang);

    const controllers: AbortController[] = [];

    // 过滤未运行的本地 provider
    let workingProviders = currentProviders;
    const localProv = workingProviders.find((p) => p.id === "local");
    if (localProv) {
      try {
        const { invoke } = await import("../../services/bridge");
        const status = await invoke<{ running: boolean }>("get_local_model_status", {
          port: currentSettings.localModel.port,
        });
        if (!status.running) {
          workingProviders = workingProviders.filter((p) => p.id !== "local");
          logger.info("本地模型未运行，跳过本地 provider 润色");
        }
      } catch {
        // 状态检查失败，保守起见保留 provider 尝试调用
      }
    }

    // 过滤智能体指定的 providerIds（未设 = 全部）
    if (currentActiveAgent?.providerIds !== undefined) {
      workingProviders = workingProviders.filter((p) =>
        currentActiveAgent!.providerIds!.includes(p.id)
      );
    }

    let remaining = workingProviders.length;

    workingProviders.forEach((provider) => {
      const cardId = `polish-${provider.id}`;
      const start = Date.now();
      const card: CardData = {
        cardId, providerId: provider.id, providerName: provider.name,
        providerIcon: "cloud", model: provider.activeModel || provider.models[0] || "auto",
        result: "", error: null, translating: true, latency: 0,
      };
      setCards((prev) => [...prev, card]);

      const ctrl = new AbortController();
      controllers.push(ctrl);
      let text2 = "";
      let isFirstContent = true;

      (async () => {
        try {
          const { LLMAdapter } = await import("../../services/llm/adapter");
          const adapter = new LLMAdapter(provider);
          await adapter.chatStream(
            { model: provider.activeModel || provider.models[0] || "gpt-4o-mini",
              messages: [{ role: "user", content: userMsg }],
              temperature: provider.temperature ?? currentActiveAgent?.temperature ?? 0.7,
              max_tokens: provider.maxTokens ?? currentActiveAgent?.maxTokens ?? 4096,
              reasoning_effort: provider.reasoningEffort },
            (delta: string) => {
              if (isFirstContent) {
                // First real content: clear any thinking indicator
                isFirstContent = false;
                text2 = delta;
              } else {
                text2 += delta;
              }
              setCards((prev) => prev.map((c) => c.cardId === cardId
                ? { ...c, result: text2 } : c));
            },
            ctrl.signal,
            () => {
              // Reasoning model is thinking — show indicator
              if (isFirstContent) {
                setCards((prev) => prev.map((c) => c.cardId === cardId
                  ? { ...c, result: "⏳ 深度思考中..." } : c));
              }
            }
          );
          setCards((prev) => prev.map((c) => c.cardId === cardId
            ? { ...c, translating: false, latency: Date.now() - start } : c));
          logger.info(`[Polish:${provider.id}] 完成 chars=${text2.length} latency=${Date.now() - start}ms\n  result: ${text2.slice(0, 300)}`);
          // Accumulate result for session
          sessionResultsRef.current.push({
            providerName: provider.name,
            providerId: provider.id,
            model: provider.activeModel || provider.models[0] || "auto",
            translatedText: text2,
            latency: Date.now() - start,
          });
        } catch (e: any) {
          if (e?.name !== "AbortError") {
            setCards((prev) => prev.map((c) => c.cardId === cardId
              ? { ...c, error: e?.message || "润色失败", translating: false } : c));
          }
        } finally {
          remaining--;
          if (remaining <= 0) {
            // Commit session when all providers finish
            if (sessionMetaRef.current.sourceText && sessionResultsRef.current.length > 0) {
              useHistoryStore.getState().addSession({
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                ...sessionMetaRef.current,
                timestamp: Date.now(),
                isFavorite: false,
                results: sessionResultsRef.current,
              });
            }
            setIsTranslating(false);
          }
        }
      })();
    });

    abortRefs.current = controllers;
  }, []);  // reads fresh config via getState() on every call

  // ---- Stop ----
  const handleStop = useCallback(() => {
    abortRefs.current.forEach((c) => c.abort());
    abortRefs.current = [];
    setIsTranslating(false);
    setCards((prev) => prev.map((c) => c.translating ? { ...c, translating: false } : c));
  }, []);

  // ---- Clear ----
  const handleClear = useCallback(() => {
    setCards([]);
  }, []);

  const polishOn = !!(activeAgent?.prompt && providers.length > 0);

  return (
    <div className="flex flex-col h-full bg-lexi-bg">
      {editingAgentId !== null && (
        <AgentManager editAgentId={editingAgentId} onClose={onCloseAgentEditor} />
      )}
      {editingAgentId === null && (
        <div style={{ display: view === "history" ? "flex" : "none", flex: 1, minHeight: 0 }}>
          <HistoryPanel onClose={onBack} onReuseText={setReuseText} />
        </div>
      )}
      {editingAgentId === null && (
        <div style={{ display: view === "settings" ? "flex" : "none", flex: 1, minHeight: 0 }}>
          <SettingsDialog onClose={onBack} defaultTab={activeAgent?.prompt ? undefined : "bergamot"} />
        </div>
      )}

      {editingAgentId === null && (
        <div className="flex flex-col h-full min-h-0 pt-4"
          style={{ display: view === "translation" ? "flex" : "none" }}>
          {/* Status bar */}
          <div className="flex items-center gap-2 px-5 py-1.5 text-xs text-lexi-text-muted border-b border-lexi-border/50 shrink-0">
            <span>{activeAgent?.icon || "🔄"}</span>
            <span className="font-medium text-lexi-text">{activeAgent?.name || "直接翻译"}</span>
            <span className="text-lexi-border">|</span>
            {polishOn ? (
              <>
                <span>{providers.length} 个 API</span>
                {isTranslating && cards.some((c) => c.translating) && (
                  <span className="flex items-center gap-1 text-lexi-accent">
                    <Loader2 size={10} className="animate-spin" /> 润色中...
                  </span>
                )}
              </>
            ) : (
              <span className="flex items-center gap-1"><WifiOff size={10} /> 离线模式</span>
            )}
            {isTranslating && !cards.some((c) => c.cardId === "polish" && c.translating) && (
              <span className="text-lexi-accent">翻译中...</span>
            )}
          </div>

          {/* Main content */}
          <div className="flex flex-col flex-1 min-h-0 gap-3 px-5 py-5">
            {settings.inputPosition === "bottom" ? (
              <>
                {/* OutputCards area */}
                {settings.cardDisplay === "tabs" ? (
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex shrink-0 border-b border-lexi-border">
                      {cards.map((card) => (
                        <button
                          key={card.cardId}
                          onClick={() => setSelectedCardId(card.cardId)}
                          className={`px-3 py-2 text-xs transition-colors border-b-2 -mb-px ${
                            selectedCardId === card.cardId
                              ? "font-semibold text-lexi-text border-lexi-accent"
                              : "font-normal text-lexi-text-muted border-transparent hover:text-lexi-text hover:bg-lexi-hover/20"
                          }`}
                        >
                          {card.providerName}
                          <span className="ml-1 text-[10px] opacity-60">{card.model}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 min-h-0">
                      {cards.filter((c) => c.cardId === selectedCardId).map((card) => (
                        <OutputCard
                          key={card.cardId}
                          variant="fill"
                          card={card}
                          onStop={handleStop}
                          copyState={copyState}
                          onCopy={handleCopy}
                        />
                      ))}
                    </div>
                  </div>
                ) : settings.cardDisplay === "split" ? (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    {cards.map((card) => (
                      <div key={card.cardId} className="flex-1 min-h-0">
                        <OutputCard
                          variant="fill"
                          card={card}
                          onStop={handleStop}
                          copyState={copyState}
                          onCopy={handleCopy}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                    {cards.map((card) => (
                      <div key={card.cardId} className={
                        settings.cardDisplay === "flat" ? "shrink-0" :
                        settings.cardDisplay === "accordion" && selectedCardId === card.cardId ? "flex-1 min-h-0" :
                        settings.cardDisplay === "accordion" ? "shrink-0" : ""
                      }>
                        <OutputCard
                          variant={
                            settings.cardDisplay === "flat" ? "flat" :
                            settings.cardDisplay === "accordion" && selectedCardId === card.cardId ? "fill" :
                            "contained"
                          }
                          card={card}
                          onStop={handleStop}
                          copyState={copyState}
                          onCopy={handleCopy}
                          expanded={settings.cardDisplay === "accordion" ? selectedCardId === card.cardId : undefined}
                          onToggleExpand={settings.cardDisplay === "accordion" ? () => setSelectedCardId(selectedCardId === card.cardId ? null : card.cardId) : undefined}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {/* InputArea — fixed at bottom */}
                <div className="shrink-0">
                  <InputArea
                    onTranslate={handleTranslate}
                    onStop={handleStop}
                    translating={isTranslating}
                    onClear={handleClear}
                    reuseText={reuseText}
                    onReuseConsumed={() => setReuseText(null)}
                  />
                </div>
              </>
            ) : (
              <>
                {/* InputArea — fixed at top */}
                <div className="shrink-0">
                  <InputArea
                    onTranslate={handleTranslate}
                    onStop={handleStop}
                    translating={isTranslating}
                    onClear={handleClear}
                    reuseText={reuseText}
                    onReuseConsumed={() => setReuseText(null)}
                  />
                </div>
                {/* OutputCards area */}
                {settings.cardDisplay === "tabs" ? (
                  <div className="flex flex-col flex-1 min-h-0">
                    <div className="flex shrink-0 border-b border-lexi-border">
                      {cards.map((card) => (
                        <button
                          key={card.cardId}
                          onClick={() => setSelectedCardId(card.cardId)}
                          className={`px-3 py-2 text-xs transition-colors border-b-2 -mb-px ${
                            selectedCardId === card.cardId
                              ? "font-semibold text-lexi-text border-lexi-accent"
                              : "font-normal text-lexi-text-muted border-transparent hover:text-lexi-text hover:bg-lexi-hover/20"
                          }`}
                        >
                          {card.providerName}
                          <span className="ml-1 text-[10px] opacity-60">{card.model}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 min-h-0">
                      {cards.filter((c) => c.cardId === selectedCardId).map((card) => (
                        <OutputCard
                          key={card.cardId}
                          variant="fill"
                          card={card}
                          onStop={handleStop}
                          copyState={copyState}
                          onCopy={handleCopy}
                        />
                      ))}
                    </div>
                  </div>
                ) : settings.cardDisplay === "split" ? (
                  <div className="flex-1 min-h-0 flex flex-col gap-3">
                    {cards.map((card) => (
                      <div key={card.cardId} className="flex-1 min-h-0">
                        <OutputCard
                          variant="fill"
                          card={card}
                          onStop={handleStop}
                          copyState={copyState}
                          onCopy={handleCopy}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
                    {cards.map((card) => (
                      <div key={card.cardId} className={
                        settings.cardDisplay === "flat" ? "shrink-0" :
                        settings.cardDisplay === "accordion" && selectedCardId === card.cardId ? "flex-1 min-h-0" :
                        settings.cardDisplay === "accordion" ? "shrink-0" : ""
                      }>
                        <OutputCard
                          variant={
                            settings.cardDisplay === "flat" ? "flat" :
                            settings.cardDisplay === "accordion" && selectedCardId === card.cardId ? "fill" :
                            "contained"
                          }
                          card={card}
                          onStop={handleStop}
                          copyState={copyState}
                          onCopy={handleCopy}
                          expanded={settings.cardDisplay === "accordion" ? selectedCardId === card.cardId : undefined}
                          onToggleExpand={settings.cardDisplay === "accordion" ? () => setSelectedCardId(selectedCardId === card.cardId ? null : card.cardId) : undefined}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
