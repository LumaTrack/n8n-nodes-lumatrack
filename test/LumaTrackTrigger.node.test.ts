import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { LumaTrackTrigger } from '../nodes/LumaTrackTrigger/LumaTrackTrigger.node';

const SECRET = 'whsec_test';

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

interface TriggerCall {
  body: Record<string, unknown>;
  signature: string;
  event: string;
  events?: string[];
}

async function runWebhook({ body, signature, event, events }: TriggerCall) {
  const responses: Array<{ code: number; payload: unknown }> = [];
  const rawBody = Buffer.from(JSON.stringify(body));
  const context = {
    getNodeParameter(name: string) {
      return name === 'secret' ? SECRET : events;
    },
    getRequestObject() {
      return {
        headers: { 'x-lumatrack-signature': signature, 'x-lumatrack-event': event },
        body,
        rawBody,
      };
    },
    getResponseObject() {
      return {
        status(code: number) {
          return {
            json(payload: unknown) {
              responses.push({ code, payload });
            },
          };
        },
      };
    },
    helpers: {
      returnJsonArray: (items: object[]) => items.map((json) => ({ json })),
    },
  };
  const node = new LumaTrackTrigger();
  const result = await node.webhook.call(context as never);
  return { result, responses };
}

describe('LumaTrackTrigger webhook', () => {
  const body = { event: 'run.held', run: { public_id: 'run_01ABC' } };
  const rawBody = Buffer.from(JSON.stringify(body));

  it('starts the workflow for a correctly signed delivery', async () => {
    const { result, responses } = await runWebhook({
      body,
      signature: sign(rawBody),
      event: 'run.held',
    });
    expect(responses).toEqual([]);
    expect(result.workflowData).toEqual([[{ json: body }]]);
  });

  it('rejects a tampered signature with 401 and no workflow start', async () => {
    const { result, responses } = await runWebhook({
      body,
      signature: sign(rawBody, 'wrong-secret'),
      event: 'run.held',
    });
    expect(responses).toEqual([{ code: 401, payload: { error: 'invalid signature' } }]);
    expect(result.workflowData).toBeUndefined();
    expect(result.noWebhookResponse).toBe(true);
  });

  it('rejects a missing signature without throwing on length mismatch', async () => {
    const { responses } = await runWebhook({ body, signature: '', event: 'run.held' });
    expect(responses).toEqual([{ code: 401, payload: { error: 'invalid signature' } }]);
  });

  it('acknowledges but ignores events outside the filter so LumaTrack does not retry', async () => {
    const { result, responses } = await runWebhook({
      body,
      signature: sign(rawBody),
      event: 'period.closed',
      events: ['run.held'],
    });
    expect(responses).toEqual([{ code: 200, payload: { ignored: 'period.closed' } }]);
    expect(result.workflowData).toBeUndefined();
  });

  it('starts the workflow when the event matches the filter', async () => {
    const { result } = await runWebhook({
      body,
      signature: sign(rawBody),
      event: 'run.held',
      events: ['run.held', 'period.closed'],
    });
    expect(result.workflowData).toEqual([[{ json: body }]]);
  });

  it('offers every subscribable platform event in the filter dropdown', async () => {
    // The platform's outbound catalog (docs/webhooks.md). A new event type
    // ships with a dropdown entry or unfiltered workflows are the only way
    // to receive it.
    const node = new LumaTrackTrigger();
    const eventsProperty = node.description.properties.find((p) => p.name === 'events');
    const values = (eventsProperty?.options ?? []).map(
      (o) => (o as { value: string }).value,
    );
    expect(new Set(values)).toEqual(
      new Set([
        'alert.fired',
        'api_key.created',
        'event.recorded',
        'event.resolved',
        'initiative.implemented',
        'initiative.transitioned',
        'period.closed',
        'report_link.created',
        'run.held',
        'shared_cost.created',
        'webhook.created',
      ]),
    );
  });

  it('rejects a multi-byte signature with 401 instead of crashing', async () => {
    // A 64-char signature containing multi-byte UTF-8 passes a char-length
    // check but has a different BYTE length; timingSafeEqual would throw and
    // turn an invalid signature into a 500 (round-2 review, agy).
    const evil = 'é'.repeat(64);
    const { responses } = await runWebhook({ body, signature: evil, event: 'run.held' });
    expect(responses).toEqual([{ code: 401, payload: { error: 'invalid signature' } }]);
  });

  it('guards the subtitle expression against an undefined events parameter', () => {
    const node = new LumaTrackTrigger();
    expect(node.description.subtitle).toBe(
      '={{($parameter["events"] || []).join(", ") || "all events"}}',
    );
  });

  it('treats an undefined events parameter as no filter instead of crashing', async () => {
    const { result } = await runWebhook({
      body,
      signature: sign(rawBody),
      event: 'run.held',
      events: undefined as never,
    });
    expect(result.workflowData).toEqual([[{ json: body }]]);
  });

  it('filters the new incident events like any other', async () => {
    const incident = { event: 'event.recorded', data: { event_id: 'evt_01A', held: false } };
    const incidentRaw = Buffer.from(JSON.stringify(incident));
    const matched = await runWebhook({
      body: incident,
      signature: sign(incidentRaw),
      event: 'event.recorded',
      events: ['event.recorded', 'event.resolved'],
    });
    expect(matched.result.workflowData).toEqual([[{ json: incident }]]);
    const ignored = await runWebhook({
      body: incident,
      signature: sign(incidentRaw),
      event: 'event.recorded',
      events: ['initiative.implemented'],
    });
    expect(ignored.responses).toEqual([{ code: 200, payload: { ignored: 'event.recorded' } }]);
  });
});
