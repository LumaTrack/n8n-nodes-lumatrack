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

async function runWebhook({ body, signature, event, events = [] }: TriggerCall) {
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
});
