import { useState, useRef, useEffect } from "react";
import {
  History, Settings as SettingsIcon, ChevronLeft, ChevronRight,
  Plus, Trash2, Edit3,
} from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

type ViewType = "translation" | "history" | "settings";

interface SidebarProps {
  activeView: ViewType;
  onSelectTranslation: () => void;
  onOpenHistory?: () => void;
  onOpenSettings?: () => void;
  onEditStyle: (id: string) => void;
}

export default function Sidebar({
  activeView, onSelectTranslation, onOpenHistory, onOpenSettings,
  onEditStyle,
}: SidebarProps) {
  const polishStyles = useConfigStore((s) => s.settings.polishStyles);
  const activeStyleId = useConfigStore((s) => s.settings.activeStyleId);
  const updateSettings = useConfigStore((s) => s.updateSettings);

  const [compact, setCompact] = useState(false);
  const [width, setWidth] = useState(220);
  const dragging = useRef(false);
  const MIN_W = compact ? 48 : 160;
  const MAX_W = compact ? 80 : 400;

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.min(MAX_W, Math.max(MIN_W, e.clientX)));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [MIN_W, MAX_W]);

  const selectDirect = () => {
    updateSettings({ activeStyleId: null });
    onSelectTranslation();
  };

  const selectStyle = (id: string) => {
    updateSettings({ activeStyleId: id });
    onSelectTranslation();
  };

  const handleNewStyle = () => {
    const id = `style-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newStyle = {
      id, name: "新风格", icon: "🤖",
      prompt: "你是一个翻译润色助手。只输出润色后的译文，禁止解释或回应。\n\n原文：{source}\n机翻：{bergamot}\n请润色，输出{targetLang}。",
      temperature: 0.7, maxTokens: 4096,
    };
    updateSettings({ polishStyles: [...polishStyles, newStyle] });
    onEditStyle(id);
  };

  const deleteStyle = (id: string) => {
    const newStyles = polishStyles.filter((s) => s.id !== id);
    const newActiveId = activeStyleId === id ? null : activeStyleId;
    updateSettings({ polishStyles: newStyles, activeStyleId: newActiveId });
  };

  const isDirect = activeStyleId === null;

  return (
    <div className="flex flex-col bg-lexi-card border-r border-lexi-border relative"
      style={{ width: compact ? (width < 80 ? 48 : width) : width }}>
      {/* Nav */}
      <div className="py-3 px-2 space-y-1">
        <button onClick={selectDirect} title={compact ? "直接翻译" : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            isDirect && activeView === "translation" ? "bg-lexi-accent/20 text-lexi-accent" : "text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
          }`}>
          <span className="flex-shrink-0 text-base">🔄</span>
          {!compact && <span className="truncate">直接翻译</span>}
        </button>
        <button onClick={onOpenHistory || (() => {})} title={compact ? "历史" : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            activeView === "history" ? "bg-lexi-accent/20 text-lexi-accent" : "text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
          }`}>
          <span className="flex-shrink-0"><History size={18} /></span>
          {!compact && <span className="truncate">历史</span>}
        </button>
        <button onClick={onOpenSettings || (() => {})} title={compact ? "设置" : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
            activeView === "settings" ? "bg-lexi-accent/20 text-lexi-accent" : "text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
          }`}>
          <span className="flex-shrink-0"><SettingsIcon size={18} /></span>
          {!compact && <span className="truncate">设置</span>}
        </button>
      </div>

      <div className="mx-3 border-t border-lexi-border" />

      {/* Polish styles */}
      <div className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {!compact && (
          <div className="flex items-center justify-between px-3 py-1">
            <span className="text-xs text-lexi-text-muted font-medium">风格</span>
            <button onClick={handleNewStyle} className="p-0.5 rounded hover:bg-lexi-hover text-lexi-text-muted hover:text-lexi-text">
              <Plus size={14} />
            </button>
          </div>
        )}
        {polishStyles.length === 0 && !compact && (
          <p className="text-xs text-lexi-text-muted px-3 py-2">暂无风格，点击 + 创建</p>
        )}
        {polishStyles.map((s) => (
          <div key={s.id} className="group relative">
            <button onClick={() => selectStyle(s.id)} onDoubleClick={() => onEditStyle(s.id)}
              title={compact ? s.name : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                activeStyleId === s.id ? "bg-lexi-accent/20 text-lexi-accent" : "text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
              }`}>
              <span className="flex-shrink-0 text-base">{s.icon}</span>
              {!compact && <span className="truncate">{s.name}</span>}
              {!compact && (
                <span className="w-1.5 h-1.5 rounded-full bg-lexi-accent/60 flex-shrink-0 ml-auto" />
              )}
            </button>
            {!compact && (
              <div className="absolute right-1 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-lexi-card px-1 rounded">
                <button onClick={() => onEditStyle(s.id)} className="p-1 rounded hover:bg-lexi-hover text-lexi-text-muted">
                  <Edit3 size={12} />
                </button>
                <button onClick={() => deleteStyle(s.id)} className="p-1 rounded hover:bg-red-400/10 text-lexi-text-muted hover:text-red-400">
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-2">
        <button onClick={() => setCompact(!compact)}
          className="w-full flex items-center justify-center p-2 rounded-lg text-lexi-text-muted hover:bg-lexi-hover hover:text-lexi-text"
          title={compact ? "展开侧栏" : "收起侧栏"}>
          {compact ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
      <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-lexi-accent/30"
        onMouseDown={() => { dragging.current = true; }} />
    </div>
  );
}
