import { z } from 'zod';
/**
 * EIP-7702 — Set EOA account code (authorization) schemas.
 *
 * Mirrors the BAN EIP-7702 spec (one-signature autonomous agents):
 *   - A user EOA authorizes a BAN agent to act on their behalf by
 *     delegating (EIP-7702) to BAN permission code, bound to a strict
 *     on-chain permission profile (limits, allowlists, expiry).
 *   - The authorization tuple is a single typed object:
 *     [chain_id, address, nonce, y_parity, r, s].
 *   - `authority` deterministically binds user + agent + config:
 *       authority = keccak256(user ‖ agent ‖ configHash)
 *     so a delegated implementation (e.g. BANPermissionAccount) can enforce
 *     the exact job/budget/allowlist signed by the user — never trust
 *     off-chain permission after delegation.
 *
 * These schemas are runtime-agnostic (zod only — no viem, no Next, no
 * Firebase) so package consumers (API routes, execution engine, UI) share one
 * vocabulary.
 */
export declare const Eip7702AuthorizationSchema: z.ZodObject<{
    chainId: z.ZodNumber;
    address: z.ZodString;
    nonce: z.ZodBigInt;
    yParity: z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>;
    r: z.ZodBigInt;
    s: z.ZodBigInt;
}, z.core.$strip>;
export type Eip7702Authorization = z.infer<typeof Eip7702AuthorizationSchema>;
/** Raw tuple form (viem's Authorization type) — [chainId, address, nonce, yParity, r, s]. */
export declare const Eip7702AuthorizationTupleSchema: z.ZodTuple<[z.ZodBigInt, z.ZodString, z.ZodBigInt, z.ZodUnion<readonly [z.ZodLiteral<0>, z.ZodLiteral<1>]>, z.ZodBigInt, z.ZodBigInt], null>;
export type Eip7702AuthorizationTuple = z.infer<typeof Eip7702AuthorizationTupleSchema>;
export declare const PermissionSpendSchema: z.ZodObject<{
    spendCap: z.ZodString;
    perTransactionCap: z.ZodString;
}, z.core.$strip>;
export type PermissionSpend = z.infer<typeof PermissionSpendSchema>;
export declare const AgentPermissionSchema: z.ZodObject<{
    id: z.ZodString;
    agentId: z.ZodString;
    userId: z.ZodString;
    userAddress: z.ZodString;
    jobId: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowedProtocols: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowedContracts: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowedFunctions: z.ZodDefault<z.ZodArray<z.ZodString>>;
    allowedTokens: z.ZodDefault<z.ZodArray<z.ZodString>>;
    spend: z.ZodObject<{
        spendCap: z.ZodString;
        perTransactionCap: z.ZodString;
    }, z.core.$strip>;
    validAfter: z.ZodString;
    validUntil: z.ZodString;
    nonce: z.ZodString;
    onchainRegistryReference: z.ZodDefault<z.ZodNullable<z.ZodString>>;
    status: z.ZodDefault<z.ZodEnum<{
        PENDING: "PENDING";
        ACTIVE: "ACTIVE";
        REVOKED: "REVOKED";
        EXPIRED: "EXPIRED";
    }>>;
    createdAt: z.ZodString;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;
export declare const DelegationAuthorizationSchema: z.ZodObject<{
    userAddress: z.ZodString;
    agentId: z.ZodString;
    delegateAddress: z.ZodString;
    jobId: z.ZodOptional<z.ZodString>;
    permission: z.ZodObject<{
        id: z.ZodOptional<z.ZodString>;
        agentId: z.ZodOptional<z.ZodString>;
        userId: z.ZodOptional<z.ZodString>;
        userAddress: z.ZodOptional<z.ZodString>;
        jobId: z.ZodOptional<z.ZodOptional<z.ZodString>>;
        capabilities: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        allowedProtocols: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        allowedContracts: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        allowedFunctions: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        allowedTokens: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString>>>;
        spend: z.ZodOptional<z.ZodObject<{
            spendCap: z.ZodString;
            perTransactionCap: z.ZodString;
        }, z.core.$strip>>;
        validAfter: z.ZodOptional<z.ZodString>;
        validUntil: z.ZodOptional<z.ZodString>;
        nonce: z.ZodOptional<z.ZodString>;
        onchainRegistryReference: z.ZodOptional<z.ZodDefault<z.ZodNullable<z.ZodString>>>;
        status: z.ZodOptional<z.ZodDefault<z.ZodEnum<{
            PENDING: "PENDING";
            ACTIVE: "ACTIVE";
            REVOKED: "REVOKED";
            EXPIRED: "EXPIRED";
        }>>>;
        createdAt: z.ZodOptional<z.ZodString>;
        updatedAt: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    validAfter: z.ZodString;
    validUntil: z.ZodString;
    nonce: z.ZodString;
    domain: z.ZodObject<{
        name: z.ZodDefault<z.ZodString>;
        version: z.ZodDefault<z.ZodString>;
        chainId: z.ZodDefault<z.ZodNumber>;
        verifyingContract: z.ZodString;
    }, z.core.$strip>;
    signature: z.ZodString;
}, z.core.$strip>;
export type DelegationAuthorization = z.infer<typeof DelegationAuthorizationSchema>;
export declare const DelegationStateSchema: z.ZodObject<{
    userAddress: z.ZodString;
    agentId: z.ZodString;
    delegateAddress: z.ZodString;
    configHash: z.ZodString;
    authority: z.ZodString;
    nonce: z.ZodString;
    status: z.ZodDefault<z.ZodEnum<{
        PENDING: "PENDING";
        ACTIVE: "ACTIVE";
        REVOKED: "REVOKED";
        EXPIRED: "EXPIRED";
    }>>;
    validAfter: z.ZodString;
    validUntil: z.ZodString;
    createdAt: z.ZodString;
}, z.core.$strip>;
export type DelegationState = z.infer<typeof DelegationStateSchema>;
//# sourceMappingURL=eip7702.d.ts.map