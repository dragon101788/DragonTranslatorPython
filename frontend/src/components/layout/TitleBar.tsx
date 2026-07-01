import { useState, useEffect, useCallback } from "react";
import { History, Settings, ArrowLeft } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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
  const [maximized, setMaximized] = useState(false);
  const [appWindow, setAppWindow] = useState<ReturnType<typeof getCurrentWindow> | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    const win = getCurrentWindow();
    setAppWindow(win);

    win.isMaximized().then(setMaximized);

    let unlisten: (() => void) | undefined;
    win
      .onResized(async () => {
        const m = await win.isMaximized();
        setMaximized(m);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, []);

  const handleMouseDown = useCallback(() => {
    if (appWindow) appWindow.startDragging();
  }, [appWindow]);

  const handleMinimize = useCallback(() => {
    appWindow?.minimize().catch(console.error);
  }, [appWindow]);

  const handleToggleMaximize = useCallback(() => {
    appWindow?.toggleMaximize().catch(console.error);
  }, [appWindow]);

  const handleClose = useCallback(() => {
    if (onCloseRequest) {
      onCloseRequest();
    } else {
      appWindow?.close().catch(console.error);
    }
  }, [appWindow, onCloseRequest]);

  if (!isTauri()) {
    // Browser fallback: simple toolbar with nav buttons
    const { text } = getViewTitle(view);
    const showBack = view !== "translation" && onBack;
    return (
      <div className="flex items-center h-10 bg-lexi-bg border-b border-lexi-border shrink-0 select-none px-3 gap-2">
        {showBack && (
          <button onClick={onBack} className="p-1 rounded hover:bg-lexi-hover text-lexi-text-muted hover:text-lexi-text" aria-label="返回">
            <ArrowLeft size={16} />
          </button>
        )}
        <span className="text-sm font-semibold text-lexi-text flex-1">
          {text}
        </span>
        {onOpenHistory && (
          <button onClick={onOpenHistory} className="titlebar-btn-browser" aria-label="翻译历史">
            <History size={16} />
          </button>
        )}
        {onOpenSettings && (
          <button onClick={onOpenSettings} className="titlebar-btn-browser" aria-label="设置">
            <Settings size={16} />
          </button>
        )}
      </div>
    );
  }

  const { text } = getViewTitle(view);
  const showBack = view !== "translation" && onBack;

  return (
    <div className="flex items-center h-8 bg-lexi-bg shrink-0 select-none">
      {/* Drag area — shows current view title */}
      <div
        className="flex-1 h-full pl-3 flex items-center gap-1.5"
        onMouseDown={handleMouseDown}
      >
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
        <button
          onClick={onOpenHistory}
          className="titlebar-btn"
          aria-label="翻译历史"
        >
          <History size={13} />
        </button>
      )}
      {onOpenSettings && (
        <button
          onClick={onOpenSettings}
          className="titlebar-btn"
          aria-label="设置"
        >
          <Settings size={13} />
        </button>
      )}

      {/* Window controls */}
      <div className="flex h-full">
        <button onClick={handleMinimize} className="titlebar-btn" aria-label="最小化">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button onClick={handleToggleMaximize} className="titlebar-btn" aria-label={maximized ? "还原" : "最大化"}>
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="2.5" y="0" width="6.5" height="6.5" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="0" y="2.5" width="6.5" height="6.5" rx="0.5" fill="var(--color-lexi-bg)" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="0.5" y="0.5" width="9" height="9" rx="0.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          )}
        </button>
        <button onClick={handleClose} className="titlebar-btn titlebar-btn-close" aria-label="关闭">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" />
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
