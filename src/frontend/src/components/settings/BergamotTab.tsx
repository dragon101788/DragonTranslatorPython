import { useConfigStore } from "../../stores/configStore";

export default function BergamotTab() {
  const bergamot = useConfigStore((s) => s.settings.bergamot);
  const updateBergamot = useConfigStore((s) => s.updateBergamot);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium text-lexi-text mb-1">离线翻译设置</h3>
        <p className="text-xs text-lexi-text-muted">
          Bergamot WASM NMT 引擎，纯离线无需 API。参数调整需在下次翻译时生效。
        </p>
      </div>

      {/* Beam size */}
      <div>
        <label className="block text-xs text-lexi-text-muted mb-1">
          翻译质量 ({bergamot.beamSize})
        </label>
        <input
          type="range"
          min="1"
          max="8"
          step="1"
          value={bergamot.beamSize}
          onChange={(e) => updateBergamot({ beamSize: parseInt(e.target.value) })}
          className="w-full accent-lexi-accent"
        />
        <div className="flex justify-between text-xs text-lexi-text-muted mt-0.5">
          <span>速度优先</span>
          <span>质量优先</span>
        </div>
      </div>

      {/* Cache size */}
      <div>
        <label className="block text-xs text-lexi-text-muted mb-1">
          翻译缓存 ({bergamot.cacheSize > 0 ? `${Math.round(bergamot.cacheSize * 4 / 1024)} KB` : "关闭"})
        </label>
        <input
          type="range"
          min="0"
          max="65536"
          step="4096"
          value={bergamot.cacheSize}
          onChange={(e) => updateBergamot({ cacheSize: parseInt(e.target.value) })}
          className="w-full accent-lexi-accent"
        />
        <p className="text-xs text-lexi-text-muted mt-0.5">
          重复翻译的文本直接从缓存返回，近乎瞬时。建议 16384 (64 KB)。
        </p>
      </div>

      {/* Direction */}
      <div>
        <label className="block text-xs text-lexi-text-muted mb-1">
          翻译方向
        </label>
        <select
          value={bergamot.direction}
          onChange={(e) => updateBergamot({ direction: e.target.value as "auto" | "enzh" | "zhen" })}
          className="w-full bg-lexi-input border border-lexi-border rounded-lg px-3 py-2 text-sm text-lexi-text focus:outline-none focus:ring-1 focus:ring-lexi-accent"
        >
          <option value="auto">自动检测</option>
          <option value="enzh">英语 → 中文</option>
          <option value="zhen">中文 → 英语</option>
        </select>
      </div>
    </div>
  );
}
