# n8n-nodes-lumatrack

Record every workflow execution as a run event in [LumaTrack](https://lumatrack.io),
the system of record for automation value. Drop the node at the end of a
workflow (and on the error path, with Status set to Failure) and the value
report builds itself.

## Install

In n8n: Settings, Community Nodes, Install, enter `n8n-nodes-lumatrack`.

## Credentials

- Base URL: your LumaTrack host
- API key: Settings, API keys in LumaTrack (shown once at creation)

## Fields

Two nodes ship in this package: **LumaTrack** (operations: Record Run,
Get ROI Summary; usable as an AI Agent tool) and **LumaTrack Trigger**
(starts workflows from LumaTrack webhook events, signature-verified).

| Record Run field | Notes |
|---|---|
| Automation | Dropdown of your automations, or a slug by expression |
| Status | Success or Failure. Report failures too: they cost money and save nothing |
| Failure reason | Root cause for failures; powers the failure-reason Pareto |
| Units from input items | One run for the whole execution, units = input item count (the after-a-loop pattern) |
| Units processed | Records/items the execution worked through; -1 omits (server default 1). Drives per-unit valuation |
| Executed at | ISO 8601 for evidence that happened earlier; empty = now |
| Duration (seconds) | Optional wall-clock runtime |
| External ID | Defaults to the n8n execution ID, making retries idempotent |
| AI usage | Model + tokens, priced server-side; metered or subscription billing |
| Metered usage | Per-unit cost-component consumption by name |
| Metadata | Arbitrary JSON kept with the run |

The trigger node verifies X-LumaTrack-Signature (HMAC-SHA256 of the exact
body) with your webhook endpoint's secret; register the trigger's URL in
LumaTrack under Settings, Webhooks.

Sub-workflows report as their own executions (their execution IDs are the
idempotency default). A node inside a loop dedupes every iteration into one
run; aggregate first and report once with Units processed, or set External
ID to `={{ $execution.id }}-{{ $itemIndex }}`.

Build from source: `npm install && npm run build`.
