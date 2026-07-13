import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { createAgent, getDeveloperAgents, getAllAgents } from '@/lib/db';
import { CreateAgentRequestSchema } from '@/lib/schemas';

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const myAgents = searchParams.get('my') === 'true';

    if (myAgents) {
      // Get only authenticated user's agents
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

      const agents = await getDeveloperAgents(user.developerId);
      return NextResponse.json({
        agents: agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          capabilities: agent.capabilities,
          costPerExecution: agent.costPerExecution,
          rating: agent.rating,
          reviewCount: agent.reviewCount,
          createdAt: agent.createdAt,
        })),
      });
    } else {
      // Get all public agents
      const agents = await getAllAgents();
      return NextResponse.json({
        agents: agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          description: agent.description,
          capabilities: agent.capabilities,
          costPerExecution: agent.costPerExecution,
          rating: agent.rating,
          reviewCount: agent.reviewCount,
          developerId: agent.developerId,
          createdAt: agent.createdAt,
        })),
      });
    }
  } catch (error) {
    console.error('[v0] Get agents error:', error);
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
    const validatedData = CreateAgentRequestSchema.parse(body);

    const agentId = await createAgent({
      developerId: user.developerId,
      ...validatedData,
      rating: 0,
      reviewCount: 0,
      isActive: true,
    });

    return NextResponse.json(
      {
        message: 'Agent created successfully',
        agentId,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[v0] Create agent error:', error);

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
