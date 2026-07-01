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

  async chat(
    request: ChatCompletionRequest
  ): Promise<{ content: string; usage: ChatCompletionResponse["usage"] }> {
    const endpoint = this.getEndpoint();

    const body = JSON.stringify({ ...request, stream: false });
    logger.info(
      `[LLM] chat → ${request.model}\n` +
        `  system: ${request.messages.find((m) => m.role === "system")?.content?.slice(0, 300) || "(none)"}\n` +
        `  user:   ${request.messages.find((m) => m.role === "user")?.content?.slice(0, 300) || "(none)"}\n` +
        `  temp: ${request.temperature}  max_tokens: ${request.max_tokens}`
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.getHeaders(),
      body,
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
  }

  async chatStream(
    request: ChatCompletionRequest,
    onChunk: (delta: string) => void,
    signal?: AbortSignal
  ): Promise<{ usage: ChatCompletionResponse["usage"] }> {
    const endpoint = this.getEndpoint();

    logger.info(
      `[LLM] chatStream → ${request.model}\n` +
        `  system: ${request.messages.find((m) => m.role === "system")?.content?.slice(0, 300) || "(none)"}\n` +
        `  user:   ${request.messages.find((m) => m.role === "user")?.content?.slice(0, 300) || "(none)"}\n` +
        `  temp: ${request.temperature}  max_tokens: ${request.max_tokens}`
    );

    const response = await fetch(endpoint, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ ...request, stream: true }),
      signal,
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
        // ignore
      }
      throw error;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw { message: "浏览器不支持流式读取" } as LLMError;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;

        const jsonStr = trimmed.slice(5).trim();
        if (jsonStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) onChunk(delta);
          if (chunk.usage) usage = chunk.usage;
        } catch {
          // skip malformed chunks
        }
      }
    }

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
