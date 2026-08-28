import { NextRequest, NextResponse } from 'next/server';
import { getTokenFromRequest } from '@/lib/api-middleware';
import { verifyToken } from '@/lib/auth';
import { getHiring, getTask } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    const hiring = await getHiring(id);

    if (!hiring) {
      return NextResponse.json(
        { error: 'Hiring record not found' },
        { status: 404 }
      );
    }

    // Check if user owns this hiring record
    if (hiring.developerId !== user.developerId) {
      return NextResponse.json(
        { error: 'Unauthorized: You do not own this hiring record' },
        { status: 403 }
      );
    }

    const task = await getTask(hiring.taskId);

    return NextResponse.json({
      id: hiring.id,
      agentId: hiring.agentId,
      taskId: hiring.taskId,
      status: hiring.status,
      creditsCost: hiring.creditsCost,
      creditsRefunded: hiring.creditsRefunded,
      result: hiring.result,
      createdAt: hiring.createdAt,
      completedAt: hiring.completedAt,
      task: task ? {
        id: task.id,
        description: task.description,
        status: task.status,
        input: task.input,
        error: task.error,
      } : null,
    });
  } catch (error) {
    console.error('[v0] Get hiring error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}