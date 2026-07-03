import { History, Settings, ArrowLeft } from "lucide-react";

type ViewType = "translation" | "history" | "settings";

interface TitleBarProps {
  onCloseRequest?: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  view: ViewType;
  onBack?: () => void;
}

function getViewTitle(view: ViewType): { text: string } {
  switch (view) {
    case "history": return { text: "翻译历史" };
    case "settings": return { text: "设置" };
    default: return { text: "翻译" };
  }
}

export default function TitleBar({ onCloseRequest, onOpenHistory, onOpenSettings, view, onBack }: TitleBarProps) {
  const { text } = getViewTitle(view);
  const showBack = view !== "translation" && onBack;

  const _api = () => (window as any).pywebview?.api;

  const handleMinimize = () => {
    const api = _api();
    if (api?.window_hide) api.window_hide();
  };

  const handleClose = () => {
    if (onCloseRequest) {
      onCloseRequest();
    } else {
      const api = _api();
      if (api?.window_close) api.window_close();
    }
  };

  return (
    <div className="flex items-center h-8 bg-lexi-bg shrink-0 select-none">
      {/* Drag area — shows current view title */}
      <div className="flex-1 h-full pl-3 flex items-center gap-1.5 pywebview-drag-region">
        {showBack && (
          <button
            onClick={onBack}
            className="p-0.5 rounded hover:bg-lexi-hover text-lexi-text-muted hover:text-lexi-text transition-colors cursor-pointer"
            aria-label="返回"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ArrowLeft size={13} />
          </button>
        )}
        <span className="text-[11px] text-lexi-text-muted font-medium tracking-wide cursor-default">
          {text}
        </span>
      </div>

      {/* Nav buttons */}
      {onOpenHistory && (
        <button onClick={onOpenHistory} className="titlebar-btn" aria-label="翻译历史">
          <History size={13} />
        </button>
      )}
      {onOpenSettings && (
        <button onClick={onOpenSettings} className="titlebar-btn" aria-label="设置">
          <Settings size={13} />
        </button>
      )}

      {/* Minimize button */}
      <button onClick={handleMinimize} className="titlebar-btn" aria-label="最小化">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {/* Close button */}
      <button onClick={handleClose} className="titlebar-btn titlebar-btn-close" aria-label="关闭">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" />
          <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}
