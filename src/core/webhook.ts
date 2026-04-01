import type { WebhookConfig, RunState } from '../types/index.js';

export async function sendWebhooks(
  webhooks: WebhookConfig[],
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  for (const hook of webhooks) {
    if (hook.events && !hook.events.includes(event as any)) continue;

    try {
      const response = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...hook.headers,
        },
        body: JSON.stringify({
          event,
          timestamp: new Date().toISOString(),
          ...payload,
        }),
      });

      if (!response.ok) {
        console.error(`Webhook failed (${response.status}): ${hook.url}`);
      }
    } catch (err) {
      console.error(`Webhook error: ${hook.url} — ${(err as Error).message}`);
    }
  }
}

export function formatRunPayload(state: RunState): Record<string, unknown> {
  const completed = state.tasks.filter(t => t.status === 'completed').length;
  const failed = state.tasks.filter(t => t.status === 'failed').length;
  return {
    run_id: state.id,
    started_at: state.started_at,
    completed_at: state.completed_at,
    total_tasks: state.tasks.length,
    completed,
    failed,
    tasks: state.tasks.map(t => ({
      name: t.task.name,
      status: t.status,
      error: t.error,
    })),
  };
}
