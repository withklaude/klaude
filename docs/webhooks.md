# Webhooks

Get notified when runs complete via HTTP webhooks.

## Configuration

Add webhooks to your project or global config:

```yaml
# .klaude/config.yaml
webhooks:
  - url: https://hooks.slack.com/services/T.../B.../xxx
    events: [run_complete]
  - url: https://discord.com/api/webhooks/xxx
    events: [run_complete]
    headers:
      Content-Type: application/json
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | Webhook endpoint URL |
| `events` | string[] | Events to subscribe to (currently: `run_complete`) |
| `headers` | object | Optional custom HTTP headers |

## Payload

```json
{
  "event": "run_complete",
  "run_id": "2026-04-01T21-12-48-826Z",
  "started_at": "2026-04-01T21:12:48.826Z",
  "completed_at": "2026-04-01T21:15:36.701Z",
  "tasks_total": 5,
  "tasks_completed": 4,
  "tasks_failed": 1,
  "overnight": true
}
```

## Slack example

Use Slack's incoming webhooks. The payload is sent as JSON — configure a Slack workflow or use a simple webhook URL.

## Desktop notifications

In addition to webhooks, klaude sends OS-level notifications on run completion:
- **Terminal bell** — `\a`
- **macOS** — native notification via `osascript`
- **Linux** — `notify-send`
- **Windows** — PowerShell toast notification
