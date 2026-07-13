import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import {
  createHiring,
  createTask,
  getAgent,
  getDeveloper,
  updateDeveloper,
  getDeveloperHirings,
  createCreditTransaction,
} from '@/lib/db';
import { HireAgentRequestSchema } from '@/lib/schemas';

export async function GET(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const hirings = await getDeveloperHirings(user.developerId);

    return NextResponse.json({
      hirings: hirings.map(hiring => ({
        id: hiring.id,
        agentId: hiring.agentId,
        taskId: hiring.taskId,
        status: hiring.status,
        creditsCost: hiring.creditsCost,
        creditsRefunded: hiring.creditsRefunded,
        result: hiring.result,
        createdAt: hiring.createdAt,
        completedAt: hiring.completedAt,
      })),
    });
  } catch (error) {
    console.error('[v0] Get hirings error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getTokenFromRequest(request);

    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const user = verifyToken(token);
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const validatedData = HireAgentRequestSchema.parse(body);

    // Get agent
    const agent = await getAgent(validatedData.agentId);
    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Get developer
    const developer = await getDeveloper(user.developerId);
    if (!developer) {
      return NextResponse.json(
        { error: 'Developer not found' },
        { status: 404 }
      );
    }

    // Check if developer has enough credits
    if (developer.credits < agent.costPerExecution) {
      return NextResponse.json(
        { error: 'Insufficient credits. Required: ' + agent.costPerExecution + ', Available: ' + developer.credits },
        { status: 402 }
      );
    }

    // Create task
    const taskId = await createTask({
      agentId: agent.id,
      developerId: user.developerId,
      description: validatedData.taskDescription,
      input: validatedData.input,
      status: 'pending',
      result: null,
      error: null,
      completedAt: null,
    });

    // Create hiring record
    const hiringId = await createHiring({
      agentId: agent.id,
      taskId,
      developerId: user.developerId,
      status: 'pending',
      creditsCost: agent.costPerExecution,
      creditsRefunded: 0,
      result: null,
      completedAt: null,
    });

    // Deduct credits
    const newBalance = developer.credits - agent.costPerExecution;
    await updateDeveloper(user.developerId, {
      credits: newBalance,
    });

    // Create credit transaction
    await createCreditTransaction({
      developerId: user.developerId,
      amount: -agent.costPerExecution,
      type: 'spent',
      hiringId,
      reason: `Agent execution: ${agent.name}`,
      balanceBefore: developer.credits,
      balanceAfter: newBalance,
    });

    // Simulate agent execution (for MVP)
    setTimeout(async () => {
      try {
        // Mock result
        const mockResult = {
          status: 'completed',
          output: `Executed by agent: ${agent.name}`,
          timestamp: new Date().toISOString(),
        };

        // Update task and hiring as completed
        const updatedHiring = await getHiring(hiringId);
        if (updatedHiring?.status === 'pending') {
          await updateHiring(hiringId, {
            status: 'completed',
            result: mockResult,
            completedAt: new Date(),
          });
        }
      } catch (err) {
        console.error('[v0] Background task execution error:', err);
      }
    }, 2000);

    return NextResponse.json(
      {
        message: 'Agent hiring initiated',
        hiringId,
        taskId,
        creditsCost: agent.costPerExecution,
        newBalance,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Create hiring error:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Import getHiring and updateHiring functions
import { getHiring, updateHiring } from '@/lib/db';
