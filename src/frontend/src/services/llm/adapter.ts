import type { LLMProvider, ApiTestResult } from "../../types";
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  LLMError,
} from "./types";
import { logger } from "../logger";

export class LLMAdapter {
  private provider: LLMProvider;

  constructor(provider: LLMProvider) {
    this.provider = provider;
  }

  updateProvider(provider: LLMProvider) {
    this.provider = provider;
  }

  private getEndpoint(): string {
    const base = this.provider.baseUrl.replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }

  private getHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.provider.apiKey}`,
    };
  }

  /** Combine two optional AbortSignals — either aborts → result aborts */
  private _combineSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
    if (!a && !b) return undefined;
    if (a && !b) return a;
    if (!a && b) return b;

    const controller = new AbortController();
    const onAbort = () => {
      const reason = a?.aborted ? a.reason : b?.reason;
      controller.abort(reason);
    };
    a?.addEventListener("abort", onAbort, { once: true });
    b?.addEventListener("abort", onAbort, { once: true });
    if (a?.aborted || b?.aborted) onAbort();
    return controller.signal;
  }

  async chat(
    request: ChatCompletionRequest,
    signal?: AbortSignal
  ): Promise<{ content: string; usage: ChatCompletionResponse["usage"] }> {
    const endpoint = this.getEndpoint();

    const body = JSON.stringify({ ...request, stream: false });
    logger.info(
      `[LLM] chat → ${request.model}\n` +
        `  system: ${request.messages.find((m) => m.role === "system")?.content?.slice(0, 300) || "(none)"}\n` +
        `  user:   ${request.messages.find((m) => m.role === "user")?.content?.slice(0, 300) || "(none)"}\n` +
        `  temp: ${request.temperature}  max_tokens: ${request.max_tokens}  reasoning_effort: ${request.reasoning_effort || "off"}`
    );

    // 120s total timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(new DOMException("请求超时 (120s)", "TimeoutError")),
      120_000
    );
    const combinedSignal = this._combineSignals(signal, timeoutController.signal);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: this.getHeaders(),
        body,
        signal: combinedSignal,
      });

      if (!response.ok) {
        const error: LLMError = {
          message: `API 请求失败 (${response.status})`,
          status: response.status,
        };

        try {
          const body = await response.json();
          error.message = body.error?.message || error.message;
          error.code = body.error?.code;
        } catch {
          // ignore parse error
        }

        throw error;
      }

      const data: ChatCompletionResponse = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw { message: "API 返回了空响应" } as LLMError;
      }

      const content = data.choices[0].message.content;
      logger.info(
        `[LLM] chat ← response (${content.length} chars):\n  ${content.slice(0, 500)}`
      );

      return {
        content,
        usage: data.usage,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async chatStream(
    request: ChatCompletionRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal,
    onReasoning?: () => void
  ): Promise<{ usage: ChatCompletionResponse["usage"] }> {
    const endpoint = this.getEndpoint();

    logger.info(
      `[LLM] chatStream → ${request.model}\n` +
        `  system: ${request.messages.find((m) => m.role === "system")?.content?.slice(0, 300) || "(none)"}\n` +
        `  user:   ${request.messages.find((m) => m.role === "user")?.content?.slice(0, 300) || "(none)"}\n` +
        `  temp: ${request.temperature}  max_tokens: ${request.max_tokens}  reasoning_effort: ${request.reasoning_effort || "off"}`
    );

    // 120s total timeout, combined with caller's abort signal
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(new DOMException("请求超时 (120s)", "TimeoutError")),
      120_000
    );
    const combinedSignal = this._combineSignals(signal, timeoutController.signal);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ ...request, stream: true }),
        signal: combinedSignal,
      });
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.name === "TimeoutError" || e?.name === "AbortError") {
        throw { message: "请求超时或已取消" } as LLMError;
      }
      throw e;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
      const error: LLMError = {
        message: `API 请求失败 (${response.status})`,
        status: response.status,
      };
      try {
        const body = await response.json();
        error.message = body.error?.message || error.message;
        error.code = body.error?.code;
      } catch {
        // ignore
      }
      throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      clearTimeout(timeoutId);
      throw { message: "浏览器不支持流式读取" } as LLMError;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    let reasoningSignaled = false;
    let contentChunks = 0;
    let reasoningChunks = 0;
    let parseErrors = 0;
    const CHUNK_TIMEOUT_MS = 30_000; // per-chunk timeout

    try {
      while (true) {
        // Per-chunk timeout: if no data arrives within 30s, abort
        let result: ReadableStreamReadResult<Uint8Array>;
        try {
          result = await Promise.race([
            reader.read(),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new DOMException("流式读取超时 (30s)", "TimeoutError")),
                CHUNK_TIMEOUT_MS
              )
            ),
          ]);
        } catch (e: any) {
          if (e?.name === "TimeoutError") {
            logger.warn(`[LLM] chatStream 流超时: ${contentChunks} content chunks, ${reasoningChunks} reasoning chunks, ${parseErrors} parse errors`);
            throw { message: "流式响应超时 (30s 无数据)" } as LLMError;
          }
          throw e;
        }

        if (result.done) break;

        buffer += decoder.decode(result.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;

          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === "[DONE]") continue;

          try {
            const chunk = JSON.parse(jsonStr);

            // Track usage
            if (chunk.usage) usage = chunk.usage;

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            // Reasoning content (Seed / o-series models): signal "thinking" to UI
            const reasoning = choice.delta?.reasoning_content;
            if (reasoning) {
              reasoningChunks++;
              if (!reasoningSignaled && onReasoning) {
                reasoningSignaled = true;
                onReasoning();
              }
              // Don't call onChunk with reasoning — it's internal thought, not output
              continue;
            }

            // Real content: try delta.content first, fallback to message.content
            const content = choice.delta?.content ?? choice.message?.content;
            if (content) {
              contentChunks++;
              onChunk(content);
            }
          } catch {
            parseErrors++;
            // Log first few malformed chunks for debugging
            if (parseErrors <= 3) {
              logger.warn(`[LLM] chatStream 解析失败: ${jsonStr.slice(0, 200)}`);
            }
          }
        }
      }
    } finally {
      clearTimeout(timeoutId);
      try { reader.cancel(); } catch { /* ignore */ }
    }

    logger.info(
      `[LLM] chatStream ← 完成: ${contentChunks} content chunks, ${reasoningChunks} reasoning chunks` +
        (parseErrors > 0 ? `, ${parseErrors} parse errors` : "")
    );

    return { usage };
  }

  async fetchModels(): Promise<string[]> {
    const base = this.provider.baseUrl.replace(/\/+$/, "");
    const endpoint = `${base}/models`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      const error: LLMError = {
        message: `获取模型列表失败 (${response.status})`,
        status: response.status,
      };
      try {
        const body = await response.json();
        error.message = body.error?.message || error.message;
      } catch {
        // ignore
      }
      throw error;
    }

    const data = await response.json();
    const models: string[] = (data.data || [])
      .map((m: { id: string }) => m.id)
      .sort((a: string, b: string) => {
        // Sort: chat/instruction models first, then alphabetically
        const aIsChat = /chat|instruct|gpt|claude|gemini/i.test(a);
        const bIsChat = /chat|instruct|gpt|claude|gemini/i.test(b);
        if (aIsChat && !bIsChat) return -1;
        if (!aIsChat && bIsChat) return 1;
        return a.localeCompare(b);
      });

    return models;
  }

  async testConnection(model: string): Promise<ApiTestResult> {
    const start = Date.now();
    try {
      await this.chat({
        model,
        messages: [
          { role: "user", content: "Hello! Respond with just 'OK'." },
        ],
        temperature: 0,
        max_tokens: 10,
      });
      return {
        success: true,
        latency: Date.now() - start,
        model,
      };
    } catch (e) {
      const error = e as LLMError;
      return {
        success: false,
        latency: Date.now() - start,
        model,
        error: error.message || "未知错误",
      };
    }
  }
}
