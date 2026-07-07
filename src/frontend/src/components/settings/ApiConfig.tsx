import { useState } from "react";
import {
  Plus,
  Trash2,
  FlaskConical,
  Loader2,
  Eye,
  EyeOff,
  Download,
  Cpu,
  Cloud,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { LLMProvider } from "../../types";
import { useConfigStore } from "../../stores/configStore";
import { LLMAdapter } from "../../services/llm/adapter";

export default function ApiConfig() {
  const providers = useConfigStore((s) => s.providers);
  const addProvider = useConfigStore((s) => s.addProvider);
  const updateProvider = useConfigStore((s) => s.updateProvider);
  const deleteProvider = useConfigStore((s) => s.deleteProvider);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-lexi-text">API 服务商</h3>
        <button
          onClick={() => {
            addProvider({
              id: `provider-${Date.now()}`,
              name: "新服务商",
              baseUrl: "https://api.openai.com/v1",
              apiKey: "",
              models: [],
              isDefault: false,
              createdAt: Date.now(),
            });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-lexi-accent-hover hover:bg-lexi-accent/10 transition-colors"
        >
          <Plus size={14} />
          <span>添加服务商</span>
        </button>
      </div>

      {providers.length === 0 ? (
        <div className="py-12 text-center text-sm text-lexi-text-muted/50">
          <p>暂无 API 服务商</p>
          <p className="mt-1 text-xs">点击「添加服务商」配置在线 API，或在「本地模型」中启动离线翻译</p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              onUpdate={(updates) => updateProvider(provider.id, updates)}
              onDelete={() => deleteProvider(provider.id)}
              canDelete={providers.length > 1 || provider.id !== "local"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single provider card
// ---------------------------------------------------------------------------

interface ProviderCardProps {
  provider: LLMProvider;
  onUpdate: (updates: Partial<LLMProvider>) => void;
  onDelete: () => void;
  canDelete: boolean;
}

function ProviderCard({ provider, onUpdate, onDelete, canDelete }: ProviderCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  const isLocal = provider.id === "local";

  const handleTest = async () => {
    if (!provider.apiKey) return;
    setTesting(true);
    setStatusMsg(null);
    try {
      const adapter = new LLMAdapter(provider);
      const model = provider.models[0] || "gpt-4o-mini";
      const result = await adapter.testConnection(model);
      if (result.success) {
        setStatusMsg(`连接成功 · ${result.latency}ms · ${result.model}`);
        setTestOk(true);
      } else {
        setStatusMsg(`连接失败: ${result.error}`);
        setTestOk(false);
      }
    } catch (e: any) {
      setStatusMsg(`连接失败: ${e?.message || "未知错误"}`);
      setTestOk(false);
    }
    setTesting(false);
  };

  const handleFetch = async () => {
    if (!provider.apiKey) return;
    setFetching(true);
    setStatusMsg(null);
    try {
      const adapter = new LLMAdapter(provider);
      const models = await adapter.fetchModels();
      onUpdate({ models });
      setStatusMsg(`已拉取 ${models.length} 个模型`);
    } catch (e: any) {
      setStatusMsg(`拉取失败: ${e?.message || "未知错误"}`);
    }
    setFetching(false);
  };

  return (
    <div className="bg-lexi-card border border-lexi-border rounded-xl overflow-hidden transition-all">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-lexi-bg/30 transition-colors select-none"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isLocal
                ? "bg-green-500/10 text-green-400"
                : "bg-blue-500/10 text-blue-400"
            }`}
          >
            {isLocal ? <Cpu size={16} /> : <Cloud size={16} />}
          </div>
          <div className="text-left min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-lexi-text truncate">
                {provider.name}
              </span>
              {isLocal && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 flex-shrink-0">
                  自动管理
                </span>
              )}
              {testOk === true && (
                <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
              )}
              {testOk === false && (
                <XCircle size={13} className="text-red-400 flex-shrink-0" />
              )}
            </div>
            <p className="text-xs text-lexi-text-muted truncate">
              {provider.baseUrl || "未配置 URL"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 ml-2">
          {expanded ? <ChevronDown size={14} className="text-lexi-text-muted" /> : <ChevronRight size={14} className="text-lexi-text-muted" />}
        </div>
      </button>

      {/* Body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-lexi-border/50 pt-3">
          {/* Name */}
          <div>
            <label className="block text-[11px] text-lexi-text-muted mb-1 uppercase tracking-wide">
              名称
            </label>
            <input
              type="text"
              value={provider.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              disabled={isLocal}
              className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-[11px] text-lexi-text-muted mb-1 uppercase tracking-wide">
              Base URL
            </label>
            <input
              type="text"
              value={provider.baseUrl}
              onChange={(e) => onUpdate({ baseUrl: e.target.value })}
              disabled={isLocal}
              placeholder="https://api.openai.com/v1"
              className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent font-mono disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[11px] text-lexi-text-muted mb-1 uppercase tracking-wide">
              API Key
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={provider.apiKey}
                onChange={(e) => onUpdate({ apiKey: e.target.value })}
                disabled={isLocal}
                placeholder="sk-..."
                className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 pr-9 text-sm text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent font-mono disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-lexi-hover text-lexi-text-muted"
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </div>

          {/* Models */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] text-lexi-text-muted uppercase tracking-wide">
                模型 ({provider.models.length})
              </label>
              <button
                onClick={handleFetch}
                disabled={fetching || !provider.apiKey}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-lexi-accent-hover hover:bg-lexi-accent/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {fetching ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
                <span>拉取列表</span>
              </button>
            </div>
            {provider.models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {provider.models.map((model) => (
                  <span
                    key={model}
                    className="inline-flex items-center gap-1 px-2 py-0.5 bg-lexi-accent/10 text-lexi-accent-hover text-[11px] rounded-md font-mono"
                  >
                    {model}
                    <button
                      onClick={() =>
                        onUpdate({
                          models: provider.models.filter((m) => m !== model),
                        })
                      }
                      className="hover:text-red-400 transition-colors"
                      title="移除"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              value={provider.models.join(", ")}
              onChange={(e) =>
                onUpdate({
                  models: e.target.value
                    .split(",")
                    .map((m) => m.trim())
                    .filter(Boolean),
                })
              }
              placeholder="gpt-4o-mini, gpt-4o（逗号分隔，或点击上方按钮自动拉取）"
              className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-xs text-lexi-text placeholder-lexi-text-muted/40 focus:outline-none focus:ring-1 focus:ring-lexi-accent"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleTest}
              disabled={testing || !provider.apiKey}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 hover:bg-green-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-green-400 text-xs font-medium transition-all"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              <span>测试连接</span>
            </button>

            {canDelete && (
              <button
                onClick={onDelete}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/5 hover:bg-red-500/10 text-red-400/70 hover:text-red-400 text-xs transition-all"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            )}
          </div>

          {/* Advanced parameters (non-local providers only) */}
          {!isLocal && provider.models.length > 0 && (
            <div className="border-t border-lexi-border/50 pt-3 space-y-3">
              <span className="text-[11px] text-lexi-text-muted uppercase tracking-wide">
                高级参数
              </span>

              {/* Active model */}
              <div>
                <label className="block text-[11px] text-lexi-text-muted mb-1">
                  选用模型
                </label>
                <select
                  value={provider.activeModel || provider.models[0] || ""}
                  onChange={(e) => onUpdate({ activeModel: e.target.value })}
                  className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                >
                  {provider.models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>

              {/* Temperature */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] text-lexi-text-muted">
                    温度 ({(provider.temperature ?? 0.7).toFixed(1)})
                  </label>
                  <button
                    onClick={() => onUpdate({ temperature: undefined })}
                    className="text-[10px] text-lexi-text-muted/50 hover:text-lexi-text-muted transition-colors"
                  >
                    重置
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-lexi-text-muted w-5">0</span>
                  <input
                    type="range"
                    min="0" max="2" step="0.1"
                    value={provider.temperature ?? 0.7}
                    onChange={(e) => onUpdate({ temperature: parseFloat(e.target.value) })}
                    className="flex-1 accent-lexi-accent cursor-pointer"
                  />
                  <span className="text-[10px] text-lexi-text-muted w-5">2</span>
                </div>
              </div>

              {/* Max tokens */}
              <div>
                <label className="block text-[11px] text-lexi-text-muted mb-1">
                  最大输出长度
                </label>
                <select
                  value={provider.maxTokens ?? 4096}
                  onChange={(e) => onUpdate({ maxTokens: parseInt(e.target.value) })}
                  className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                >
                  {[512, 1024, 2048, 4096, 8192, 16384].map((v) => (
                    <option key={v} value={v}>{v} tokens</option>
                  ))}
                </select>
              </div>

              {/* Reasoning effort */}
              <div>
                <label className="block text-[11px] text-lexi-text-muted mb-1">
                  思考深度 (reasoning_effort)
                </label>
                <select
                  value={provider.reasoningEffort || ""}
                  onChange={(e) => onUpdate({ reasoningEffort: (e.target.value || undefined) as LLMProvider["reasoningEffort"] })}
                  className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
                >
                  <option value="">关闭</option>
                  <option value="low">Low — 快速推理</option>
                  <option value="medium">Medium — 平衡 (推荐)</option>
                  <option value="high">High — 深度思考</option>
                </select>
                <p className="text-[10px] text-lexi-text-muted/50 mt-0.5">
                  仅 DeepSeek / Claude / OpenAI o-series 等支持此参数的 API 生效
                </p>
              </div>
            </div>
          )}

          {/* Status message */}
          {statusMsg && (
            <div
              className={`p-2.5 rounded-lg text-xs ${
                statusMsg.includes("成功") || statusMsg.includes("已拉取")
                  ? "bg-green-500/10 text-green-400"
                  : "bg-red-500/10 text-red-400"
              }`}
            >
              {statusMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
