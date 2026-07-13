import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { getAgent, updateAgent, deleteAgent } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities: agent.capabilities,
      costPerExecution: agent.costPerExecution,
      rating: agent.rating,
      reviewCount: agent.reviewCount,
      developerId: agent.developerId,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    });
  } catch (error) {
    console.error('[v0] Get agent error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = await params;
    const agent = await getAgent(id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Check if user owns the agent
    if (agent.developerId !== user.developerId) {
      return NextResponse.json(
        { error: 'Unauthorized: You do not own this agent' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, capabilities, costPerExecution } = body;

    const updates: any = {};
    if (name) updates.name = name;
    if (description) updates.description = description;
    if (capabilities) updates.capabilities = capabilities;
    if (costPerExecution !== undefined) updates.costPerExecution = costPerExecution;

    await updateAgent(id, updates);

    return NextResponse.json({
      message: 'Agent updated successfully',
    });
  } catch (error) {
    console.error('[v0] Update agent error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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

    const { id } = await params;
    const agent = await getAgent(id);

    if (!agent) {
      return NextResponse.json(
        { error: 'Agent not found' },
        { status: 404 }
      );
    }

    // Check if user owns the agent
    if (agent.developerId !== user.developerId) {
      return NextResponse.json(
        { error: 'Unauthorized: You do not own this agent' },
        { status: 403 }
      );
    }

    await deleteAgent(id);

    return NextResponse.json({
      message: 'Agent deleted successfully',
    });
  } catch (error) {
    console.error('[v0] Delete agent error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
