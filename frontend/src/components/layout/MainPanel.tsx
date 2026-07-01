import { useCallback, useEffect, useRef, useState } from "react";
import InputArea from "../translation/InputArea";
import OutputCard from "../translation/OutputCard";
import SettingsDialog from "../settings/SettingsDialog";
import StyleManager from "../settings/StyleManager";
import HistoryPanel from "./HistoryPanel";
import { useConfigStore } from "../../stores/configStore";
import { useHistoryStore } from "../../stores/historyStore";
import { useTTS } from "../../hooks/useTTS";
import { logger } from "../../services/logger";
import type { TranslationRecord } from "../../types";
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

function makeRecord(source: string, translated: string, provider: string, model: string, latency: number): TranslationRecord {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sourceText: source,
    translatedText: translated,
    sourceLang: /[一-鿿㐀-䶿]/.test(source) ? "中文" : "英文",
    targetLang: /[一-鿿㐀-䶿]/.test(translated) ? "中文" : "英文",
    providerName: provider,
    model,
    latency,
    timestamp: Date.now(),
    isFavorite: false,
  };
}

interface MainPanelProps {
  view: ViewType;
  editingStyleId: string | null;
  onCloseStyleEditor: () => void;
  onBack: () => void;
}

export default function MainPanel({ view, editingStyleId, onCloseStyleEditor, onBack }: MainPanelProps) {
  const settings = useConfigStore((s) => s.settings);
  const tts = useTTS();

  const activeStyle = settings.activeStyleId ? settings.polishStyles.find((s) => s.id === settings.activeStyleId) || null : null;
  const providers = useConfigStore((s) => s.providers);

  // ---- Cards state ----
  const [cards, setCards] = useState<CardData[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const abortRefs = useRef<AbortController[]>([]);

  // Copy state
  const [copyState, setCopyState] = useState<Record<string, "idle" | "copied">>({});
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
      // Record history
      useHistoryStore.getState().addRecord(makeRecord(text, bergamotResult, "离线翻译", "Bergamot NMT", elapsed));
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
    const hasLLM = !!(activeStyle?.prompt && providers.length > 0);
    if (!hasLLM) {
      setIsTranslating(false);
      return;
    }

    const targetLang = /[一-鿿㐀-䶿]/.test(bergamotResult) ? "中文" : "英文";
    const userMsg = (activeStyle?.prompt || "")
      .replace("{source}", text)
      .replace("{bergamot}", bergamotResult)
      .replace("{targetLang}", targetLang);

    const controllers: AbortController[] = [];
    let remaining = providers.length;

    providers.forEach((provider) => {
      const cardId = `polish-${provider.id}`;
      const start = Date.now();
      const card: CardData = {
        cardId, providerId: provider.id, providerName: provider.name,
        providerIcon: "cloud", model: provider.models[0] || "auto",
        result: "", error: null, translating: true, latency: 0,
      };
      setCards((prev) => [...prev, card]);

      const ctrl = new AbortController();
      controllers.push(ctrl);
      let text2 = "";

      (async () => {
        try {
          const { LLMAdapter } = await import("../../services/llm/adapter");
          const adapter = new LLMAdapter(provider);
          await adapter.chatStream(
            { model: provider.models[0] || "gpt-4o-mini", messages: [{ role: "user", content: userMsg }],
              temperature: activeStyle?.temperature ?? 0.7, max_tokens: activeStyle?.maxTokens ?? 4096 },
            (delta: string) => {
              text2 += delta;
              setCards((prev) => prev.map((c) => c.cardId === cardId
                ? { ...c, result: (c.result || "") + delta } : c));
            },
            ctrl.signal,
          );
          setCards((prev) => prev.map((c) => c.cardId === cardId
            ? { ...c, translating: false, latency: Date.now() - start } : c));
          logger.info(`[Polish:${provider.id}] 完成 chars=${text2.length} latency=${Date.now() - start}ms\n  result: ${text2.slice(0, 300)}`);
          useHistoryStore.getState().addRecord(makeRecord(text, text2, provider.name, provider.models[0] || "auto", Date.now() - start));
        } catch (e: any) {
          if (e?.name !== "AbortError") {
            setCards((prev) => prev.map((c) => c.cardId === cardId
              ? { ...c, error: e?.message || "润色失败", translating: false } : c));
          }
        } finally {
          remaining--;
          if (remaining <= 0) setIsTranslating(false);
        }
      })();
    });

    abortRefs.current = controllers;
  }, [activeStyle]);

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

  const polishOn = !!(activeStyle?.prompt && providers.length > 0);

  return (
    <div className="flex flex-col h-full bg-lexi-bg">
      {editingStyleId !== null && (
        <StyleManager editStyleId={editingStyleId} onClose={onCloseStyleEditor} />
      )}
      {editingStyleId === null && view === "history" && <HistoryPanel onClose={onBack} />}
      {editingStyleId === null && view === "settings" && (
        <SettingsDialog onClose={onBack} defaultTab={activeStyle?.prompt ? undefined : "bergamot"} />
      )}

      {editingStyleId === null && view === "translation" && (
        <div className="flex flex-col h-full min-h-0 overflow-y-auto pt-4">
          {/* Status bar */}
          <div className="flex items-center gap-2 px-5 py-1.5 text-xs text-lexi-text-muted border-b border-lexi-border/50">
            <span>{activeStyle?.icon || "🔄"}</span>
            <span className="font-medium text-lexi-text">{activeStyle?.name || "直接翻译"}</span>
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
          <div className="flex flex-col gap-3 px-5 py-5">
            <InputArea
              onTranslate={handleTranslate}
              onStop={handleStop}
              translating={isTranslating}
              onClear={handleClear}
            />
            {cards.map((card) => (
              <OutputCard
                key={card.cardId}
                card={card}
                onStop={handleStop}
                copyState={copyState}
                onCopy={handleCopy}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
