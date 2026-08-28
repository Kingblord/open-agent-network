import type { ToolCapability, ToolResult } from '@ban/schemas';
import { type ToolAdapters } from './tools.js';
/**
 * M6 — ToolRegistry.
 *
 * The AI is ONLY able to invoke tools returned by `listTools(capabilities)` for
 * its capability set. Every call enforces:
 *   1. tool exists (unknown tool names fail closed),
 *   2. agent has the required ToolCapability,
 *   3. tool input passes its schema validation.
 */
export declare class ToolRegistry {
    private readonly tools;
    constructor(adapters: ToolAdapters);
    listTools(capabilities: ToolCapability[]): Array<{
        name: string;
        description: string;
        capabilityId: ToolCapability;
    }>;
    has(toolName: string): boolean;
    call(toolName: string, input: unknown, context: {
        agentCapabilities: ToolCapability[];
        correlationId?: string;
    }): Promise<ToolResult>;
    private fail;
}
/** Convenience builder wired to the deterministic dev provider. */
export declare function createDevToolRegistry(): ToolRegistry;
//# sourceMappingURL=tool-registry.d.ts.map