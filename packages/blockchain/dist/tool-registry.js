import { BANError } from '@ban/shared';
import { buildToolHandles } from './tools.js';
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
    tools = new Map();
    constructor(adapters) {
        for (const handle of buildToolHandles(adapters)) {
            this.tools.set(handle.name, handle);
        }
    }
    listTools(capabilities) {
        return [...this.tools.values()]
            .filter((t) => capabilities.includes(t.capabilityId))
            .map((t) => ({ name: t.name, description: t.description, capabilityId: t.capabilityId }));
    }
    has(toolName) {
        return this.tools.has(toolName);
    }
    async call(toolName, input, context) {
        const tool = this.tools.get(toolName);
        if (!tool) {
            return this.fail(toolName, context, 'ERR_TOOL_NOT_FOUND', `unknown tool '${toolName}'`);
        }
        if (!context.agentCapabilities.includes(tool.capabilityId)) {
            return this.fail(toolName, context, 'ERR_CAPABILITY_NOT_GRANTED', `agent lacks capability '${tool.capabilityId}' required by tool '${toolName}'`);
        }
        try {
            tool.inputSchema.parse(input);
        }
        catch (err) {
            return this.fail(toolName, context, 'ERR_TOOL_INVALID_INPUT', `input validation failed: ${err.message}`);
        }
        try {
            const output = await tool.invoke(input);
            return {
                ok: true,
                tool: toolName,
                output,
                timestamp: new Date().toISOString(),
            };
        }
        catch (err) {
            const code = err instanceof BANError ? err.code : 'ERR_TOOL_FAILED';
            return this.fail(toolName, context, code, err instanceof Error ? err.message : 'tool invocation failed');
        }
    }
    fail(toolName, context, code, message) {
        return {
            ok: false,
            tool: toolName,
            error: { code, message },
            timestamp: new Date().toISOString(),
        };
    }
}
/** Convenience builder wired to the deterministic dev provider. */
export function createDevToolRegistry() {
    return new ToolRegistry(DevDataProvider.instance());
}
