import type { ToolCapability, ToolResult } from '@ban/schemas';
import { BANError } from '@ban/shared';
import { buildToolHandles, type ToolAdapters, type ToolHandle } from './tools.js';
import { DevDataProvider } from './dev-provider.js';

/**
 * M6 — ToolRegistry.
 *
 * The AI is ONLY able to invoke tools returned by `listTools(capabilities)` for
 * its capability set. Every call enforces:
 *   1. tool exists (unknown tool names fail closed),
 *   2. agent has the required ToolCapability,
 *   3. tool input passes its schema validation.
 */
export class ToolRegistry {
  private readonly tools: Map<string, ToolHandle> = new Map();

  constructor(adapters: ToolAdapters) {
    for (const handle of buildToolHandles(adapters)) {
      this.tools.set(handle.name, handle);
    }
  }

  listTools(capabilities: ToolCapability[]): Array<{ name: string; description: string; capabilityId: ToolCapability }> {
    return [...this.tools.values()]
      .filter((t) => capabilities.includes(t.capabilityId))
      .map((t) => ({ name: t.name, description: t.description, capabilityId: t.capabilityId }));
  }

  has(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  async call(
    toolName: string,
    input: unknown,
    context: { agentCapabilities: ToolCapability[]; correlationId?: string }
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);
    if (!tool) {
      return this.fail(toolName, context, 'ERR_TOOL_NOT_FOUND', `unknown tool '${toolName}'`);
    }
    if (!context.agentCapabilities.includes(tool.capabilityId)) {
      return this.fail(
        toolName,
        context,
        'ERR_CAPABILITY_NOT_GRANTED',
        `agent lacks capability '${tool.capabilityId}' required by tool '${toolName}'`
      );
    }
    try {
      tool.inputSchema.parse(input);
    } catch (err) {
      return this.fail(toolName, context, 'ERR_TOOL_INVALID_INPUT', `input validation failed: ${(err as Error).message}`);
    }
    try {
      const output = await tool.invoke(input);
      return {
        ok: true,
        tool: toolName,
        output,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      const code = err instanceof BANError ? err.code : 'ERR_TOOL_FAILED';
      return this.fail(toolName, context, code, err instanceof Error ? err.message : 'tool invocation failed');
    }
  }

  private fail(
    toolName: string,
    context: { correlationId?: string },
    code: string,
    message: string
  ): ToolResult {
    return {
      ok: false,
      tool: toolName,
      error: { code, message },
      timestamp: new Date().toISOString(),
    };
  }
}

/** Convenience builder wired to the deterministic dev provider. */
export function createDevToolRegistry(): ToolRegistry {
  return new ToolRegistry(DevDataProvider.instance());
}