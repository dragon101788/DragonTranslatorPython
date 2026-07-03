import { useMemo, useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check, AlertCircle, Clock, Loader2, Volume2, Square } from "lucide-react";
import { useTTS } from "../../hooks/useTTS";

interface OutputAreaProps {
  result: string | null;
  error: string | null;
  translating: boolean;
  latency: number;
}

export default function OutputArea({
  result,
  error,
  translating,
  latency,
}: OutputAreaProps) {
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tts = useTTS();

  // Auto-scroll to bottom during streaming
  useEffect(() => {
    if (translating && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [result, translating]);

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = result;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const statusBar = useMemo(() => {
    if (translating && !result) return null;

    return (
      <div className="flex items-center gap-3 text-xs text-lexi-text-muted">
        {translating && (
          <span className="flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" />
            <span>生成中...</span>
          </span>
        )}
        {!translating && latency > 0 && (
          <span className="flex items-center gap-1">
            <Clock size={12} />
            {latency < 1000 ? `${latency}ms` : `${(latency / 1000).toFixed(1)}s`}
          </span>
        )}
        {result && !translating && (
          <button
            onClick={() => {
              if (tts.isSpeaking) {
                tts.stop();
              } else if (result) {
                tts.speak(result.replace(/<[^>]*>/g, ""), "");
              }
            }}
            className="flex items-center gap-1 hover:text-lexi-text transition-colors"
            title={tts.isSpeaking ? "停止朗读" : "朗读译文"}
          >
            {tts.isSpeaking ? <Square size={12} /> : <Volume2 size={12} />}
            <span>{tts.isSpeaking ? "停止" : "朗读"}</span>
          </button>
        )}
        {result && !translating && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 hover:text-lexi-text transition-colors"
          >
            {copied ? (
              <>
                <Check size={12} className="text-lexi-success" />
                <span className="text-lexi-success">已复制</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>复制</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  }, [result, error, translating, latency, copied]);

  // Loading: no content yet
  if (translating && !result) {
    return (
      <div className="flex items-center justify-center h-full bg-lexi-card border border-lexi-border">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-lexi-accent/30 border-t-lexi-accent rounded-full animate-spin" />
          <span className="text-sm text-lexi-text-muted">正在翻译...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30">
        <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-medium text-red-400">翻译出错</div>
          <div className="text-sm text-red-300/80 mt-1">{error}</div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex items-center justify-center h-full bg-lexi-card border border-lexi-border border-dashed">
        <div className="text-center text-lexi-text-muted">
          <div className="text-3xl mb-2">✨</div>
          <div className="text-sm">输入文本，开始离线翻译</div>
          <div className="text-xs mt-1 opacity-60">Enter 翻译, Shift+Enter 换行</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-lexi-card border border-lexi-border overflow-hidden">
      {/* Content */}
      <div ref={scrollRef} className="flex-1 p-4 overflow-y-auto">
        <div className="markdown-body text-sm text-lexi-text">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
        </div>
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-lexi-border/50">
        {statusBar}
      </div>
    </div>
  );
}
