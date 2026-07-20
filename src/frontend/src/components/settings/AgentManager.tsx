import { useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

const ICON_OPTIONS = ["🔄","💬","📚","🎓","🎨","🤖","✨","🔮","💡","🌍","📝","🎯","🔥","⭐","💎","🎭","🧠","🚀","🌈","🎵"];

interface AgentManagerProps {
  editAgentId: string; // always an existing agent id (created immediately on "+")
  onClose: () => void;
}

export default function AgentManager({ editAgentId, onClose }: AgentManagerProps) {
  const polishStyles = useConfigStore((s) => s.settings.polishStyles);
  const activeStyleId = useConfigStore((s) => s.settings.activeStyleId);
  const updateSettings = useConfigStore((s) => s.updateSettings);
  const providers = useConfigStore((s) => s.providers);

  const agent = polishStyles.find((s) => s.id === editAgentId);
  if (!agent) { onClose(); return null; }

  const [name, setName] = useState(agent.name);
  const [icon, setIcon] = useState(agent.icon);
  const [prompt, setPrompt] = useState(agent.prompt);
  const [temperature, setTemperature] = useState(agent.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(agent.maxTokens ?? 4096);
  const [selectedIds, setSelectedIds] = useState<string[] | undefined>(agent.providerIds);

  useEffect(() => {
    setName(agent.name);
    setIcon(agent.icon);
    setPrompt(agent.prompt);
    setTemperature(agent.temperature ?? 0.7);
    setMaxTokens(agent.maxTokens ?? 4096);
    setSelectedIds(agent.providerIds);
  }, [editAgentId]);

  // Write to store on every change
  const update = (updates: Partial<typeof agent>) => {
    updateSettings({
      polishStyles: polishStyles.map((s) =>
        s.id === editAgentId ? { ...s, ...updates } : s
      ),
    });
  };

  // Provider multi-select logic
  const isSelectAll = selectedIds === undefined;
  const validProviderIds = new Set(providers.map((p) => p.id));
  const staleIds = selectedIds ? selectedIds.filter((id) => !validProviderIds.has(id)) : [];

  const toggleSelectAll = () => {
    const next = isSelectAll ? [] : undefined;
    setSelectedIds(next);
    update({ providerIds: next });
  };

  const toggleProvider = (providerId: string) => {
    const current = selectedIds ?? providers.map((p) => p.id);
    const next = current.includes(providerId)
      ? current.filter((id) => id !== providerId)
      : [...current, providerId];
    // If all providers are selected, switch to "all" mode (undefined)
    const allSelected = providers.every((p) => next.includes(p.id));
    const final = allSelected ? undefined : next;
    setSelectedIds(final);
    update({ providerIds: final });
  };

  const deleteAgent = () => {
    const newStyles = polishStyles.filter((s) => s.id !== editAgentId);
    const newActiveId = activeStyleId === editAgentId ? null : activeStyleId;
    updateSettings({ polishStyles: newStyles, activeStyleId: newActiveId });
    onClose();
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="bg-lexi-card flex flex-col min-h-0 h-full">
        {/* Header */}
        <div className="flex items-center px-5 py-4">
          <h2 className="text-lg font-semibold text-lexi-text">编辑智能体</h2>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-lexi-text-muted mb-1">名称</label>
              <input type="text" value={name}
                onChange={(e) => { setName(e.target.value); update({ name: e.target.value.trim() || agent.name }); }}
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

            {/* Provider 多选 */}
            <div>
              <label className="block text-xs text-lexi-text-muted mb-2">API Provider</label>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-lexi-hover cursor-pointer">
                  <input type="checkbox" checked={isSelectAll} onChange={toggleSelectAll}
                    className="accent-lexi-accent" />
                  <span className="text-sm text-lexi-text">全选</span>
                  <span className="text-xs text-lexi-text-muted">（未选择时默认使用全部 provider）</span>
                </label>
                <div className="border-t border-lexi-border/50 my-1" />
                {!isSelectAll && providers.map((p) => {
                  const checked = selectedIds?.includes(p.id) ?? false;
                  return (
                    <label key={p.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-lexi-hover cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => toggleProvider(p.id)}
                        className="accent-lexi-accent" />
                      <span className="text-sm text-lexi-text">{p.name}</span>
                      {p.models[0] && <span className="text-xs text-lexi-text-muted">({p.models[0]})</span>}
                    </label>
                  );
                })}
                {/* 失效的 provider（已删除） */}
                {!isSelectAll && staleIds.map((id) => (
                  <label key={id} className="flex items-center gap-2 px-2 py-1.5 rounded opacity-50">
                    <input type="checkbox" checked disabled className="accent-lexi-accent" />
                    <span className="text-sm text-lexi-text-muted line-through">已删除 ({id})</span>
                    <button onClick={() => toggleProvider(id)} className="text-xs text-red-400 hover:text-red-300 ml-auto">移除</button>
                  </label>
                ))}
              </div>
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
            <button onClick={deleteAgent}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-400/10">
              <Trash2 size={14} /> 删除此智能体
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
