import { describe, expect, it } from 'vitest';

import { LumaTrack } from '../nodes/LumaTrack/LumaTrack.node';

interface HttpCall {
  method: string;
  url: string;
  body?: Record<string, unknown>;
}

const RECORD_RUN_DEFAULTS: Record<string, unknown> = {
  operation: 'recordRun',
  automation: 'invoice-sync',
  status: 'success',
  failureReason: '',
  unitsFromItems: false,
  units: -1,
  durationSeconds: -1,
  externalId: 'exec-77',
  executedAt: '',
  aiUsage: {},
  usage: '{}',
  metadata: '{}',
};

function executeContext({
  params = {},
  items = [{ json: {} }],
  continueOnFail = false,
  requestError,
}: {
  params?: Record<string, unknown>;
  items?: Array<{ json: object }>;
  continueOnFail?: boolean;
  requestError?: Error;
} = {}) {
  const resolved = { ...RECORD_RUN_DEFAULTS, ...params };
  const calls: HttpCall[] = [];
  const context = {
    getInputData: () => items,
    getCredentials: async () => ({ baseUrl: 'https://lt.example.com/' }),
    // Item-index aware, like the real n8n runtime: a param value may be a
    // function of the item index (models per-item expression resolution).
    getNodeParameter: (name: string, i: number) => {
      const value = resolved[name];
      return typeof value === 'function' ? (value as (i: number) => unknown)(i) : value;
    },
    continueOnFail: () => continueOnFail,
    getNode: () => ({
      id: 'node-1',
      name: 'LumaTrack',
      type: 'n8n-nodes-lumatrack.lumaTrack',
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    helpers: {
      httpRequestWithAuthentication: async (_credential: string, options: HttpCall) => {
        calls.push(options);
        if (requestError) throw requestError;
        return { ok: true, public_id: 'run_01ABC' };
      },
    },
  };
  return { context, calls };
}

async function run(setup: Parameters<typeof executeContext>[0] = {}) {
  const { context, calls } = executeContext(setup);
  const node = new LumaTrack();
  const result = await node.execute.call(context as never);
  return { result, calls };
}

describe('LumaTrack record run', () => {
  it('posts the run with the credential base URL trimmed and source stamped', async () => {
    const { calls } = await run();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://lt.example.com/api/v1/runs');
    expect(calls[0].body).toEqual({
      automation: 'invoice-sync',
      status: 'success',
      source: 'n8n',
      external_id: 'exec-77',
    });
  });

  it('omits sentinel -1 fields and sends real zero values', async () => {
    const { calls } = await run({ params: { durationSeconds: 0, units: -1 } });
    expect(calls[0].body).toMatchObject({ duration_seconds: 0 });
    expect(calls[0].body).not.toHaveProperty('units');
  });

  it('sends explicit units', async () => {
    const { calls } = await run({ params: { units: 30 } });
    expect(calls[0].body).toMatchObject({ units: 30 });
  });

  it('reports one run with units = item count in aggregate mode', async () => {
    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const { calls } = await run({ params: { unitsFromItems: true, units: 999 }, items });
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({ units: 3 });
  });

  it('reports one run per item outside aggregate mode', async () => {
    const items = [{ json: {} }, { json: {} }];
    const { calls } = await run({ items });
    expect(calls).toHaveLength(2);
  });

  it('carries the failure reason only for failures', async () => {
    const failure = await run({ params: { status: 'failure', failureReason: 'auth/credential' } });
    expect(failure.calls[0].body).toMatchObject({
      status: 'failure',
      failure_reason: 'auth/credential',
    });
    const success = await run({ params: { status: 'success', failureReason: 'auth/credential' } });
    expect(success.calls[0].body).not.toHaveProperty('failure_reason');
  });

  it('maps AI usage to the API payload', async () => {
    const { calls } = await run({
      params: {
        aiUsage: {
          model: 'claude-sonnet-5',
          inputTokens: 10000,
          outputTokens: 2000,
          cachedTokens: 500,
          billing: 'subscription',
        },
      },
    });
    expect(calls[0].body).toMatchObject({
      ai: {
        model: 'claude-sonnet-5',
        input_tokens: 10000,
        output_tokens: 2000,
        cached_tokens: 500,
        billing: 'subscription',
      },
    });
  });

  it('refuses tokens without a model instead of silently dropping the AI cost', async () => {
    await expect(run({ params: { aiUsage: { inputTokens: 10000 } } })).rejects.toThrow(/Model/);
  });

  it('fails loudly on invalid metadata JSON', async () => {
    await expect(run({ params: { metadata: '{not json' } })).rejects.toThrow(/Metadata/);
  });

  it('passes metered usage through by component name', async () => {
    const { calls } = await run({ params: { usage: '{"tokens": 1840}' } });
    expect(calls[0].body).toMatchObject({ usage: { tokens: 1840 } });
  });

  it('records an error item instead of failing the workflow under Continue On Fail', async () => {
    const { result } = await run({
      continueOnFail: true,
      requestError: new Error('LumaTrack unreachable'),
    });
    expect(result).toEqual([
      [{ json: { error: 'LumaTrack unreachable' }, pairedItem: { item: 0 } }],
    ]);
  });

  it('throws a NodeApiError when Continue On Fail is off', async () => {
    await expect(run({ requestError: new Error('LumaTrack unreachable') })).rejects.toThrow();
  });
});

const RECORD_EVENT_DEFAULTS: Record<string, unknown> = {
  operation: 'recordEvent',
  eventType: 'unplanned-truck-roll',
  downtimeMinutes: -1,
  costOverride: '',
  eventExternalId: 'exec-77',
  occurredAt: '',
  eventMetadata: '{}',
};

describe('LumaTrack record incident', () => {
  it('posts the event with source stamped and idempotency carried', async () => {
    const { calls } = await run({ params: { ...RECORD_EVENT_DEFAULTS } });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://lt.example.com/api/v1/events');
    expect(calls[0].body).toEqual({
      event_type: 'unplanned-truck-roll',
      source: 'n8n',
      external_id: 'exec-77',
    });
  });

  it('omits sentinel -1 downtime and sends a real zero', async () => {
    const zero = await run({ params: { ...RECORD_EVENT_DEFAULTS, downtimeMinutes: 0 } });
    expect(zero.calls[0].body).toMatchObject({ downtime_minutes: 0 });
    const omitted = await run({ params: { ...RECORD_EVENT_DEFAULTS, downtimeMinutes: -1 } });
    expect(omitted.calls[0].body).not.toHaveProperty('downtime_minutes');
  });

  it('sends cost override and occurred at only when set', async () => {
    const { calls } = await run({
      params: {
        ...RECORD_EVENT_DEFAULTS,
        costOverride: '412.50',
        occurredAt: '2026-07-20T08:00:00Z',
      },
    });
    expect(calls[0].body).toMatchObject({
      cost_override: '412.50',
      occurred_at: '2026-07-20T08:00:00Z',
    });
  });

  it('records one incident per input item', async () => {
    const { calls } = await run({
      params: { ...RECORD_EVENT_DEFAULTS },
      items: [{ json: {} }, { json: {} }],
    });
    expect(calls).toHaveLength(2);
  });

  it('fails loudly on invalid metadata JSON', async () => {
    await expect(
      run({ params: { ...RECORD_EVENT_DEFAULTS, eventMetadata: '{not json' } }),
    ).rejects.toThrow(/Metadata/);
  });

  it('records an error item instead of failing the workflow under Continue On Fail', async () => {
    const { result } = await run({
      params: { ...RECORD_EVENT_DEFAULTS },
      continueOnFail: true,
      requestError: new Error('LumaTrack unreachable'),
    });
    expect(result).toEqual([
      [{ json: { error: 'LumaTrack unreachable' }, pairedItem: { item: 0 } }],
    ]);
  });

  it('defaults the external ID to a per-item unique expression', () => {
    // A shared $execution.id would dedupe N batched incidents into 1 on the
    // server (review round 1, high): the default must vary per item.
    const node = new LumaTrack();
    const property = node.description.properties.find((p) => p.name === 'eventExternalId');
    expect(property?.default).toBe('={{$execution.id}}-{{$itemIndex}}');
  });

  it('sends distinct external IDs when the expression resolves per item', async () => {
    const { calls } = await run({
      params: {
        ...RECORD_EVENT_DEFAULTS,
        eventExternalId: (i: number) => `exec-77-${i}`,
      },
      items: [{ json: {} }, { json: {} }],
    });
    expect(calls.map((c) => c.body?.external_id)).toEqual(['exec-77-0', 'exec-77-1']);
  });

  it('sends a zero cost override instead of dropping it as falsy', async () => {
    const { calls } = await run({
      params: { ...RECORD_EVENT_DEFAULTS, costOverride: 0 },
    });
    expect(calls[0].body).toMatchObject({ cost_override: 0 });
  });

  it('refuses fractional or below-sentinel downtime instead of sending it', async () => {
    await expect(
      run({ params: { ...RECORD_EVENT_DEFAULTS, downtimeMinutes: 1.5 } }),
    ).rejects.toThrow(/integer/);
    await expect(
      run({ params: { ...RECORD_EVENT_DEFAULTS, downtimeMinutes: -2 } }),
    ).rejects.toThrow(/integer/);
  });

  it('refuses non-object metadata JSON', async () => {
    await expect(
      run({ params: { ...RECORD_EVENT_DEFAULTS, eventMetadata: '[1, 2]' } }),
    ).rejects.toThrow(/object/);
  });

  it('turns per-item validation failures into error items under Continue On Fail', async () => {
    const { result, calls } = await run({
      params: {
        ...RECORD_EVENT_DEFAULTS,
        eventMetadata: (i: number) => (i === 0 ? '{not json' : '{}'),
        eventExternalId: (i: number) => `exec-77-${i}`,
      },
      items: [{ json: {} }, { json: {} }],
      continueOnFail: true,
    });
    expect(calls).toHaveLength(1);
    const out = result[0];
    expect(out).toHaveLength(2);
    expect(out[0].json).toHaveProperty('error');
    expect(out[1].json).toEqual({ ok: true, public_id: 'run_01ABC' });
  });

  it('does nothing on an empty input array', async () => {
    const { result, calls } = await run({
      params: { ...RECORD_EVENT_DEFAULTS },
      items: [],
    });
    expect(calls).toEqual([]);
    expect(result).toEqual([[]]);
  });
});

describe('LumaTrack resolve incident', () => {
  it('posts the resolution with measured downtime', async () => {
    const { calls } = await run({
      params: { operation: 'resolveEvent', eventId: 'evt_01XYZ', resolveDowntimeMinutes: 45 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://lt.example.com/api/v1/events/evt_01XYZ/resolve');
    expect(calls[0].body).toEqual({ downtime_minutes: 45 });
  });

  it('sends an empty body when downtime is the -1 sentinel', async () => {
    const { calls } = await run({
      params: { operation: 'resolveEvent', eventId: 'evt_01XYZ', resolveDowntimeMinutes: -1 },
    });
    expect(calls[0].body).toEqual({});
  });

  it('refuses an empty event ID', async () => {
    await expect(
      run({ params: { operation: 'resolveEvent', eventId: '', resolveDowntimeMinutes: -1 } }),
    ).rejects.toThrow(/[Ee]vent ID/);
  });

  it('sends a real zero downtime at resolution', async () => {
    const { calls } = await run({
      params: { operation: 'resolveEvent', eventId: 'evt_01XYZ', resolveDowntimeMinutes: 0 },
    });
    expect(calls[0].body).toEqual({ downtime_minutes: 0 });
  });

  it('keeps processing later items when one event ID is empty under Continue On Fail', async () => {
    const { result, calls } = await run({
      params: {
        operation: 'resolveEvent',
        eventId: (i: number) => (i === 0 ? '' : 'evt_01XYZ'),
        resolveDowntimeMinutes: -1,
      },
      items: [{ json: {} }, { json: {} }],
      continueOnFail: true,
    });
    expect(calls).toHaveLength(1);
    expect(result[0][0].json).toHaveProperty('error');
    expect(result[0][1].json).toEqual({ ok: true, public_id: 'run_01ABC' });
  });
});

describe('LumaTrack aggregate pairing and loadOptions', () => {
  it('pairs the aggregate run with every contributing input item', async () => {
    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const { result } = await run({ params: { unitsFromItems: true }, items });
    expect(result[0][0].pairedItem).toEqual([{ item: 0 }, { item: 1 }, { item: 2 }]);
  });

  it('pairs an aggregate validation failure with every contributing input item too', async () => {
    const items = [{ json: {} }, { json: {} }];
    const { result, calls } = await run({
      params: { unitsFromItems: true, metadata: '{not json' },
      items,
      continueOnFail: true,
    });
    expect(calls).toEqual([]);
    expect(result[0][0].json).toHaveProperty('error');
    expect(result[0][0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
  });

  it('loads automations and event types for the dropdowns', async () => {
    const calls: HttpCall[] = [];
    const loadContext = {
      getCredentials: async () => ({ baseUrl: 'https://lt.example.com/' }),
      helpers: {
        httpRequestWithAuthentication: async (_c: string, options: HttpCall) => {
          calls.push(options);
          if (options.url.endsWith('/api/v1/automations')) {
            return {
              automations: [
                { slug: 'invoice-sync', name: 'Invoice sync', status: 'active' },
                { slug: 'new-thing', name: 'New thing', status: 'candidate' },
              ],
            };
          }
          return {
            event_types: [
              { slug: 'wan-outage', name: 'WAN outage', is_active: true },
              { slug: 'old-tamper', name: 'Old tamper', is_active: false },
            ],
          };
        },
      },
    };
    const node = new LumaTrack();
    const automations = await node.methods.loadOptions.getAutomations.call(loadContext as never);
    expect(automations).toEqual([
      { name: 'Invoice sync', value: 'invoice-sync' },
      { name: 'New thing (candidate)', value: 'new-thing' },
    ]);
    const eventTypes = await node.methods.loadOptions.getEventTypes.call(loadContext as never);
    expect(eventTypes).toEqual([
      { name: 'WAN outage', value: 'wan-outage' },
      { name: 'Old tamper (inactive)', value: 'old-tamper' },
    ]);
    expect(calls.map((c) => c.url)).toEqual([
      'https://lt.example.com/api/v1/automations',
      'https://lt.example.com/api/v1/event-types',
    ]);
  });
});

describe('LumaTrack get summary', () => {
  it('fetches the summary once regardless of input items', async () => {
    const { result, calls } = await run({
      params: { operation: 'getSummary' },
      items: [{ json: {} }, { json: {} }],
    });
    expect(calls).toEqual([
      { method: 'GET', url: 'https://lt.example.com/api/v1/summary', json: true },
    ]);
    expect(result).toEqual([
      [{ json: { ok: true, public_id: 'run_01ABC' }, pairedItem: { item: 0 } }],
    ]);
  });
});
