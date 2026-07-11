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
    getNodeParameter: (name: string) => resolved[name],
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
