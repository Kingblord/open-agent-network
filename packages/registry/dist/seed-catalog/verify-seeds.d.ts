/** CLI + reusable verification helpers. Entry point for the `verify:seeds`
 * script. Importing this module from elsewhere MUST NOT trigger network I/O —
 * the CLI runs only when executed directly (`node dist/seed-catalog/verify-seeds.js`). */
import { createPublicClient } from 'viem';
export interface VerificationResult {
    address: string;
    label: string;
    codeExisted: boolean;
    sourceVerified: boolean | null;
}
/** Cheap on-chain existence check (does code actually exist at this address?). */
export declare function verifyCodeExists(publicClient: ReturnType<typeof createPublicClient>, address: `0x${string}`): Promise<boolean>;
/** Optional BscScan source verification (name/proxy match) when a key is present. */
export declare function verifyBscScanSource(address: string): Promise<boolean | null>;
/**
 * Verify every deployment/token candidate in the catalog. Returns the set of
 * entries whose on-chain existence is confirmed (candidates-to-flip). Does
 * NOT mutate anything itself — callers apply the promotion explicitly.
 */
export declare function verifySeedCatalog(): Promise<VerificationResult[]>;
/** Read + verify the fetched Aave/Lista candidates (read-only, never catalog mutation). */
export declare function verifyFetchedCandidates(): Promise<VerificationResult[]>;
/** Promotion decision: code exists AND (no BscScan key OR source verified). */
export declare function shouldPromote(r: VerificationResult, haveKey: boolean): boolean;
//# sourceMappingURL=verify-seeds.d.ts.map