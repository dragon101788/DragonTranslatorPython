import { useRef, useEffect } from "react";
import { StopCircle, Copy, Check, Loader2, Cloud, Cpu, Volume2, Square, ChevronDown } from "lucide-react";
interface CardStream {
  providerId: string;
  providerName: string;
  providerIcon: string;
  model: string;
  result: string | null;
  error: string | null;
  translating: boolean;
  latency: number;
}
import { useTTS } from "../../hooks/useTTS";

interface OutputCardProps {
  card: CardStream;
  onStop: (providerId: string) => void;
  copyState: Record<string, "idle" | "copied">;
  onCopy: (providerId: string, text: string) => void;
  expanded?: boolean;
  onToggleExpand?: () => void;
  /** "flat"=auto-grow no limit, "contained"=max-400+scroll, "fill"=fill parent height */
  variant?: "flat" | "contained" | "fill";
}

export default function OutputCard({
  card,
  onStop,
  copyState,
  onCopy,
  expanded,
  onToggleExpand,
  variant,
}: OutputCardProps) {
  const tts = useTTS();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (variant === "fill") return; // CSS fills parent, no JS needed
    if (variant === "flat") {
      // Flat mode: always fit content height, no scrollbar
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
      return;
    }
    // Contained mode: auto-grow only during streaming (CSS max-h caps it)
    if (card.translating) {
      el.scrollTop = el.scrollHeight;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [card.result, card.translating, variant]);

  const isLocal = card.providerIcon === "local";
  const copied = copyState[card.providerId] === "copied";
  const isAccordion = onToggleExpand !== undefined;
  // In accordion mode, show body when expanded or translating; otherwise always show
  const showBody = isAccordion ? (expanded || card.translating) : true;

  return (
    <div className={`bg-lexi-card border border-lexi-border rounded-xl overflow-hidden flex flex-col ${variant === "fill" ? "h-full" : ""}`}>
      {/* Header — select-none prevents selection leak */}
      <div
        className={`flex items-center justify-between px-4 py-2.5 border-b border-lexi-border/50 bg-lexi-bg/30 select-none ${
          isAccordion ? "cursor-pointer hover:bg-lexi-hover/50 transition-colors" : ""
        }`}
        onClick={isAccordion ? onToggleExpand : undefined}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isAccordion && (
            <ChevronDown
              size={14}
              className={`text-lexi-text-muted flex-shrink-0 transition-transform duration-200 ${
                showBody ? "rotate-0" : "-rotate-90"
              }`}
            />
          )}
          <div
            className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${
              isLocal
                ? "bg-green-500/10 text-green-400"
                : "bg-blue-500/10 text-blue-400"
            }`}
          >
            {isLocal ? <Cpu size={13} /> : <Cloud size={13} />}
          </div>
          <span className="text-xs font-medium text-lexi-text truncate">
            {card.providerName}
          </span>
          <span className="text-[10px] text-lexi-text-muted/60 flex-shrink-0">
            {card.model}
          </span>
          {!card.translating && card.latency > 0 && (
            <span className="text-[10px] text-lexi-text-muted/40 flex-shrink-0">
              {card.latency}ms
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {card.translating ? (
            <button
              onClick={() => onStop(card.providerId)}
              className="p-1 rounded hover:bg-red-500/10 text-red-400 transition-colors"
              title="停止"
            >
              <StopCircle size={13} />
            </button>
          ) : card.result ? (
            <>
              <button
                onClick={() => {
                  if (card.result) onCopy(card.providerId, card.result);
                }}
                className="p-1 rounded hover:bg-lexi-hover text-lexi-text-muted hover:text-lexi-text transition-colors"
                title="复制"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
              <button
                onClick={() => {
                  if (tts.isSpeaking) {
                    tts.stop();
                  } else if (card.result) {
                    tts.speak(card.result!.replace(/<[^>]*>/g, ""), "");
                  }
                }}
                className="p-1 rounded hover:bg-lexi-hover text-lexi-text-muted hover:text-lexi-text transition-colors"
                title={tts.isSpeaking ? "停止朗读" : "朗读"}
              >
                {tts.isSpeaking ? <Square size={13} /> : <Volume2 size={13} />}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Body — textarea for native selection isolation, same as InputArea */}
      {showBody && (
        <>
          {card.error ? (
            <p className="px-4 py-3 text-sm text-red-400/80 select-none">{card.error}</p>
          ) : card.translating && !card.result ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-lexi-text-muted select-none">
              <Loader2 size={13} className="animate-spin" />
              <span>加载中...</span>
            </div>
          ) : card.result != null ? (
            <textarea
              ref={textareaRef}
              readOnly
              value={card.result}
              className={`w-full bg-transparent text-lexi-text px-4 py-3 resize-none focus:outline-none text-sm leading-relaxed border-none ${
                variant === "flat"
                  ? "min-h-[80px]"
                  : variant === "fill"
                    ? "flex-1 min-h-0 overflow-y-auto"
                    : "min-h-[80px] max-h-[400px] overflow-y-auto"
              }`}
              rows={3}
            />
          ) : (
            <p className="px-4 py-3 text-xs text-lexi-text-muted/40 select-none">
              等待输入...
            </p>
          )}

          {/* Streaming indicator */}
          {card.translating && (
            <div className="h-0.5 bg-lexi-accent/40 animate-pulse" />
          )}
        </>
      )}
    </div>
  );
}
