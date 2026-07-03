import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

const ICON_OPTIONS = ["🔄","💬","📚","🎓","🎨","🤖","✨","🔮","💡","🌍","📝","🎯","🔥","⭐","💎","🎭","🧠","🚀","🌈","🎵"];

interface StyleManagerProps {
  editStyleId: string; // always an existing style id (created immediately on "+")
  onClose: () => void;
}

export default function StyleManager({ editStyleId, onClose }: StyleManagerProps) {
  const polishStyles = useConfigStore((s) => s.settings.polishStyles);
  const activeStyleId = useConfigStore((s) => s.settings.activeStyleId);
  const updateSettings = useConfigStore((s) => s.updateSettings);

  const style = polishStyles.find((s) => s.id === editStyleId);
  if (!style) { onClose(); return null; }

  const [name, setName] = useState(style.name);
  const [icon, setIcon] = useState(style.icon);
  const [prompt, setPrompt] = useState(style.prompt);
  const [temperature, setTemperature] = useState(style.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(style.maxTokens ?? 4096);

  useEffect(() => {
    setName(style.name);
    setIcon(style.icon);
    setPrompt(style.prompt);
    setTemperature(style.temperature ?? 0.7);
    setMaxTokens(style.maxTokens ?? 4096);
  }, [editStyleId]);

  // Write to store on every change
  const update = (updates: Partial<typeof style>) => {
    updateSettings({
      polishStyles: polishStyles.map((s) =>
        s.id === editStyleId ? { ...s, ...updates } : s
      ),
    });
  };

  const deleteStyle = () => {
    const newStyles = polishStyles.filter((s) => s.id !== editStyleId);
    const newActiveId = activeStyleId === editStyleId ? null : activeStyleId;
    updateSettings({ polishStyles: newStyles, activeStyleId: newActiveId });
    onClose();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-lexi-card flex flex-col min-h-0 h-full">
        {/* Header */}
        <div className="flex items-center px-5 py-4">
          <h2 className="text-lg font-semibold text-lexi-text">编辑风格</h2>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-lexi-text-muted mb-1">名称</label>
              <input type="text" value={name}
                onChange={(e) => { setName(e.target.value); update({ name: e.target.value.trim() || style.name }); }}
                placeholder="例如：口语润色"
                className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent" />
            </div>
            <div>
              <label className="block text-xs text-lexi-text-muted mb-1">图标</label>
              <div className="grid grid-cols-10 gap-1">
                {ICON_OPTIONS.map((emoji) => (
                  <button key={emoji} onClick={() => { setIcon(emoji); update({ icon: emoji }); }}
                    className={`w-8 h-8 flex items-center justify-center rounded text-lg ${icon === emoji ? "bg-lexi-accent/20 ring-1 ring-lexi-accent/40" : "hover:bg-lexi-hover"}`}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-lexi-text-muted mb-1">系统提示词</label>
              <textarea value={prompt}
                onChange={(e) => { setPrompt(e.target.value); update({ prompt: e.target.value }); }}
                rows={8} placeholder="给 LLM 的系统提示词..."
                className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent resize-none font-mono" />
            </div>
          </div>

          {/* Temperature + Max Tokens */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-lexi-text-muted mb-1">温度 ({temperature.toFixed(1)})</label>
              <input type="range" min="0" max="2" step="0.1" value={temperature}
                onChange={(e) => { const v = parseFloat(e.target.value); setTemperature(v); update({ temperature: v }); }}
                className="w-full accent-lexi-accent" />
              <div className="flex justify-between text-xs text-lexi-text-muted mt-0.5">
                <span>精确</span><span>创意</span>
              </div>
            </div>
            <div>
              <label className="block text-xs text-lexi-text-muted mb-1">最大 Token</label>
              <select value={maxTokens}
                onChange={(e) => { const v = parseInt(e.target.value); setMaxTokens(v); update({ maxTokens: v }); }}
                className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent">
                <option value={512}>512</option>
                <option value={1024}>1024</option>
                <option value={2048}>2048</option>
                <option value={4096}>4096</option>
                <option value={8192}>8192</option>
                <option value={16384}>16384</option>
              </select>
            </div>
          </div>

          {/* Delete */}
          <div className="pt-3 border-t border-lexi-border">
            <button onClick={deleteStyle}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10">
              <Trash2 size={14} /> 删除此风格
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
