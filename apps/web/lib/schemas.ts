import { z } from 'zod';

// Developer Schema
export const DeveloperSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  password: z.string().min(8),
  credits: z.number().default(50),
  tier: z.enum(['free', 'pro', 'enterprise']).default('free'),
  // Optional onchain wallet bound to the account (connected via Thirdweb).
  // Nullable so disconnecting clears it; optional so existing records without
  // the field still parse.
  walletAddress: z.string().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Developer = z.infer<typeof DeveloperSchema>;

// API Key Schema
export const ApiKeySchema = z.object({
  id: z.string(),
  developerId: z.string(),
  keyHash: z.string(),
  name: z.string(),
  createdAt: z.date(),
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
});

export type ApiKey = z.infer<typeof ApiKeySchema>;

// Agent Schema
export const AgentSchema = z.object({
  id: z.string(),
  developerId: z.string(),
  name: z.string(),
  description: z.string(),
  capabilities: z.array(z.string()),
  costPerExecution: z.number().positive(),
  rating: z.number().min(0).max(5).default(0),
  reviewCount: z.number().default(0),
  createdAt: z.date(),
  updatedAt: z.date(),
  isActive: z.boolean().default(true),
});

export type Agent = z.infer<typeof AgentSchema>;

// Task Schema
export const TaskSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  developerId: z.string(),
  description: z.string(),
  input: z.record(z.string(), z.any()),
  status: z.enum(['pending', 'processing', 'completed', 'failed']).default('pending'),
  result: z.any().nullable(),
  error: z.string().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});

export type Task = z.infer<typeof TaskSchema>;

// Hiring Record Schema
export const HiringSchema = z.object({
  id: z.string(),
  agentId: z.string(),
  taskId: z.string(),
  developerId: z.string(),
  status: z.enum(['pending', 'processing', 'completed', 'failed', 'refunded']).default('pending'),
  creditsCost: z.number().positive(),
  creditsRefunded: z.number().default(0),
  result: z.any().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
});

export type Hiring = z.infer<typeof HiringSchema>;

// Credit Transaction Schema
export const CreditTransactionSchema = z.object({
  id: z.string(),
  developerId: z.string(),
  amount: z.number(),
  type: z.enum(['earned', 'purchased', 'spent', 'refunded']),
  hiringId: z.string().nullable(),
  reason: z.string(),
  balanceBefore: z.number(),
  balanceAfter: z.number(),
  createdAt: z.date(),
});

export type CreditTransaction = z.infer<typeof CreditTransactionSchema>;

// Auth Request/Response Schemas
export const SignupRequestSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
});

export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const CreateAgentRequestSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(10),
  capabilities: z.array(z.string()).min(1),
  costPerExecution: z.number().positive(),
});

export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;

export const HireAgentRequestSchema = z.object({
  agentId: z.string(),
  taskDescription: z.string(),
  input: z.record(z.string(), z.any()),
});

export type HireAgentRequest = z.infer<typeof HireAgentRequestSchema>;