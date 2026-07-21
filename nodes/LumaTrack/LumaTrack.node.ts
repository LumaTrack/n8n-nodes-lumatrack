import type {
  IExecuteFunctions,
  JsonObject,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  NodeConnectionType,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export class LumaTrack implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LumaTrack',
    name: 'lumaTrack',
    icon: { light: 'file:lumatrack.svg', dark: 'file:lumatrack.dark.svg' },
    group: ['output'],
    version: 1,
    subtitle:
      '={{$parameter["operation"] === "getSummary" ? "Get ROI Summary" : $parameter["operation"] === "recordEvent" ? $parameter["eventType"] : $parameter["operation"] === "resolveEvent" ? "Resolve Incident" : $parameter["automation"]}}',
    description:
      'Record automation run events and incidents in LumaTrack, or read the value summary',
    defaults: { name: 'LumaTrack' },
    inputs: ['main' as NodeConnectionType],
    outputs: ['main' as NodeConnectionType],
    credentials: [{ name: 'lumaTrackApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Get ROI Summary',
            value: 'getSummary',
            action: 'Get the ROI summary',
            description: "The organization's realized value summary",
          },
          {
            name: 'Record Incident',
            value: 'recordEvent',
            action: 'Record an incident',
            description:
              'Report one loss event (ticket, outage, truck roll) to the loss ledger',
          },
          {
            name: 'Record Run',
            value: 'recordRun',
            action: 'Record a run event',
            description: 'Report one execution (success or failure) to the value ledger',
          },
          {
            name: 'Resolve Incident',
            value: 'resolveEvent',
            action: 'Resolve an incident',
            description: 'Stamp an incident resolved and record its measured downtime',
          },
        ],
        default: 'recordRun',
      },
      {
        displayName: 'Automation Name or ID',
        name: 'automation',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getAutomations' },
        default: '',
        required: true,
        displayOptions: { show: { operation: ['recordRun'] } },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'Failure', value: 'failure' },
          { name: 'Success', value: 'success' },
        ],
        default: 'success',
        displayOptions: { show: { operation: ['recordRun'] } },
        description:
          'Report failures too: they cost money and save nothing, and the ledger prices that honestly',
      },
      {
        displayName: 'Failure Reason',
        name: 'failureReason',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['recordRun'], status: ['failure'] } },
        description:
          "Root cause, e.g. 'auth/credential', or map your error branch's message with an expression; powers the failure-reason Pareto",
      },
      {
        displayName: 'Units From Input Items',
        name: 'unitsFromItems',
        type: 'boolean',
        default: false,
        displayOptions: { show: { operation: ['recordRun'] } },
        description:
          'Whether to report ONE run for this execution with units = the number of input items. The recommended pattern after a loop: one run, honest volume, no dedupe surprises.',
      },
      {
        displayName: 'Units Processed',
        name: 'units',
        type: 'number',
        default: -1,
        displayOptions: { show: { operation: ['recordRun'], unitsFromItems: [false] } },
        description:
          'Records/items this execution processed (set it with an expression from your batch size); -1 omits the field and the server defaults to 1. Multiplies value when the automation is valued per unit.',
      },
      {
        displayName: 'Duration (Seconds)',
        name: 'durationSeconds',
        type: 'number',
        default: -1,
        displayOptions: { show: { operation: ['recordRun'] } },
        description: 'Wall-clock runtime of the execution; -1 omits the field (0 is a real duration)',
      },
      {
        displayName: 'External ID',
        name: 'externalId',
        type: 'string',
        default: '={{$execution.id}}',
        displayOptions: { show: { operation: ['recordRun'] } },
        description: 'Makes ingestion idempotent; defaults to the n8n execution ID',
      },
      {
        displayName: 'Executed At',
        name: 'executedAt',
        type: 'string',
        default: '',
        placeholder: '2026-07-11T14:30:00Z',
        displayOptions: { show: { operation: ['recordRun'] } },
        description:
          'ISO 8601 timestamp for evidence that genuinely happened earlier (reporter workflows, batches). Leave empty for live events; frozen months are refused.',
      },
      {
        displayName: 'AI Usage',
        name: 'aiUsage',
        type: 'collection',
        placeholder: 'Add AI Usage',
        default: {},
        displayOptions: { show: { operation: ['recordRun'] } },
        description:
          'Token usage for LLM runs; LumaTrack prices it server-side from its model price table. Map from the AI Agent node output.',
        options: [
          {
            displayName: 'Billing',
            name: 'billing',
            type: 'options',
            options: [
              { name: 'Metered (API)', value: 'metered' },
              { name: 'Flat-Rate Subscription', value: 'subscription' },
            ],
            default: 'metered',
            description:
              'Subscription books $0 marginal cost and tracks the API-equivalent as repricing exposure',
          },
          {
            displayName: 'Cached Tokens',
            name: 'cachedTokens',
            type: 'number',
            default: 0,
            description: 'Cache-read tokens',
          },
          {
            displayName: 'Cost Override',
            name: 'cost',
            type: 'string',
            default: '',
            description: 'Optional decimal override of the computed cost, e.g. 0.0421',
          },
          {
            displayName: 'Input Tokens',
            name: 'inputTokens',
            type: 'number',
            default: 0,
            description: 'Non-cached input tokens',
          },
          {
            displayName: 'Model',
            name: 'model',
            type: 'string',
            default: '',
            placeholder: 'claude-sonnet-5',
            description: 'Model ID; required for the rest of this block to book',
          },
          {
            displayName: 'Output Tokens',
            name: 'outputTokens',
            type: 'number',
            default: 0,
          },
        ],
      },
      {
        displayName: 'Metered Usage (JSON)',
        name: 'usage',
        type: 'json',
        default: '{}',
        displayOptions: { show: { operation: ['recordRun'] } },
        description:
          'Actual consumption per per-unit cost component, by component name, e.g. {"tokens": 1840}; overrides the component default for this run only',
      },
      {
        displayName: 'Metadata (JSON)',
        name: 'metadata',
        type: 'json',
        default: '{}',
        displayOptions: { show: { operation: ['recordRun'] } },
        description: 'Arbitrary JSON kept with the run',
      },
      {
        displayName: 'Event Type Name or ID',
        name: 'eventType',
        type: 'options',
        typeOptions: { loadOptionsMethod: 'getEventTypes' },
        default: '',
        required: true,
        displayOptions: { show: { operation: ['recordEvent'] } },
        description:
          'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
      },
      {
        displayName: 'Downtime (Minutes)',
        name: 'downtimeMinutes',
        type: 'number',
        default: -1,
        displayOptions: { show: { operation: ['recordEvent'] } },
        description:
          'MEASURED downtime only; dollars are never estimated from a guess. -1 omits the field (0 is a real zero).',
      },
      {
        displayName: 'Cost Override',
        name: 'costOverride',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['recordEvent'] } },
        description:
          'The actual total cost of this event as a decimal, e.g. 412.50; empty lets LumaTrack compute it from the event type cost model',
      },
      {
        displayName: 'External ID',
        name: 'eventExternalId',
        type: 'string',
        default: '={{$execution.id}}-{{$itemIndex}}',
        displayOptions: { show: { operation: ['recordEvent'] } },
        description:
          'Makes ingestion idempotent (a retried delivery is not a double-counted incident) and must be unique per incident: the default combines the n8n execution ID with the item index so a batch of N alerts books N incidents. Use your ticket or alert ID when one exists.',
      },
      {
        displayName: 'Occurred At',
        name: 'occurredAt',
        type: 'string',
        default: '',
        placeholder: '2026-07-20T08:00:00Z',
        displayOptions: { show: { operation: ['recordEvent'] } },
        description:
          'ISO 8601 timestamp for incidents that genuinely happened earlier. Leave empty for live events; frozen months are refused.',
      },
      {
        displayName: 'Metadata (JSON)',
        name: 'eventMetadata',
        type: 'json',
        default: '{}',
        displayOptions: { show: { operation: ['recordEvent'] } },
        description: 'Arbitrary JSON kept with the incident',
      },
      {
        displayName: 'Event ID',
        name: 'eventId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['resolveEvent'] } },
        description:
          "The incident's ID (evt_...), from a Record Incident output or an Incident Recorded trigger event",
      },
      {
        displayName: 'Downtime (Minutes)',
        name: 'resolveDowntimeMinutes',
        type: 'number',
        default: -1,
        displayOptions: { show: { operation: ['resolveEvent'] } },
        description:
          'Total MEASURED downtime for the incident, recorded at resolution; -1 omits the field (0 is a real zero)',
      },
    ],
		usableAsTool: true,
  };

  methods = {
    loadOptions: {
      async getAutomations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('lumaTrackApi');
        const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');
        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'lumaTrackApi',
          { method: 'GET', url: `${baseUrl}/api/v1/automations`, json: true },
        );
        const automations = (response.automations ?? []) as Array<{
          slug: string;
          name: string;
          status: string;
        }>;
        return automations.map((a) => ({
          name: a.status === 'candidate' ? `${a.name} (candidate)` : a.name,
          value: a.slug,
        }));
      },
      async getEventTypes(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        const credentials = await this.getCredentials('lumaTrackApi');
        const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');
        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'lumaTrackApi',
          { method: 'GET', url: `${baseUrl}/api/v1/event-types`, json: true },
        );
        const eventTypes = (response.event_types ?? []) as Array<{
          slug: string;
          name: string;
          is_active: boolean;
        }>;
        return eventTypes.map((et) => ({
          name: et.is_active ? et.name : `${et.name} (inactive)`,
          value: et.slug,
        }));
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    if (!items.length) return [out];
    const credentials = await this.getCredentials('lumaTrackApi');
    const baseUrl = String(credentials.baseUrl).replace(/\/+$/, '');
    const operation = this.getNodeParameter('operation', 0) as string;

    if (operation === 'getSummary') {
      const response = await this.helpers.httpRequestWithAuthentication.call(
        this,
        'lumaTrackApi',
        { method: 'GET', url: `${baseUrl}/api/v1/summary`, json: true },
      );
      return [[{ json: response, pairedItem: { item: 0 } }]];
    }

    const parseJsonParameter = (raw: unknown, name: string, itemIndex: number) => {
      let value: unknown;
      try {
        value = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw;
      } catch {
        throw new NodeOperationError(
          this.getNode(),
          `${name} must be valid JSON (an object like {"hosts": 240}).`,
          { itemIndex },
        );
      }
      if (value !== undefined && value !== null) {
        if (typeof value !== 'object' || Array.isArray(value)) {
          throw new NodeOperationError(
            this.getNode(),
            `${name} must be a JSON object (like {"hosts": 240}), not a list or scalar.`,
            { itemIndex },
          );
        }
      }
      return value && Object.keys(value as object).length ? value : undefined;
    };

    // Measured minutes: -1 omits the field, anything else must be a
    // non-negative integer — a fractional or below-sentinel value is a
    // mapping bug, not a measurement.
    const readMinutes = (name: string, label: string, i: number): number | undefined => {
      const value = this.getNodeParameter(name, i) as number;
      if (value === -1) return undefined;
      if (!Number.isInteger(value) || value < 0) {
        throw new NodeOperationError(
          this.getNode(),
          `${label} must be a non-negative integer (or -1 to omit it), got ${value}.`,
          { itemIndex: i },
        );
      }
      return value;
    };

    // One POST per item, honoring Continue On Fail the same way for every
    // write operation: an error item instead of a failed workflow.
    const post = async (
      url: string,
      body: Record<string, unknown>,
      i: number,
      pairedItem: INodeExecutionData['pairedItem'] = { item: i },
    ) => {
      try {
        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'lumaTrackApi',
          { method: 'POST', url, body, json: true },
        );
        out.push({ json: response, pairedItem });
      } catch (requestError) {
        if (this.continueOnFail()) {
          out.push({ json: { error: (requestError as Error).message }, pairedItem });
          return;
        }
        throw new NodeApiError(this.getNode(), requestError as JsonObject);
      }
    };

    // Per-item validation failures become error items under Continue On
    // Fail, exactly like delivery failures: one bad mapping must not abort
    // the batch and discard the already-recorded items' responses. (post()
    // never throws under Continue On Fail, so anything caught here is a
    // validation error.)
    const perItem = async (
      i: number,
      work: () => Promise<void>,
      pairedItem: INodeExecutionData['pairedItem'] = { item: i },
    ) => {
      if (!this.continueOnFail()) {
        await work();
        return;
      }
      try {
        await work();
      } catch (validationError) {
        out.push({
          json: { error: (validationError as Error).message },
          pairedItem,
        });
      }
    };

    if (operation === 'recordEvent') {
      for (let i = 0; i < items.length; i++) {
        await perItem(i, async () => {
          const body: Record<string, unknown> = {
            event_type: this.getNodeParameter('eventType', i),
            source: 'n8n',
          };
          const downtime = readMinutes('downtimeMinutes', 'Downtime (Minutes)', i);
          if (downtime !== undefined) body.downtime_minutes = downtime;
          const costOverride = this.getNodeParameter('costOverride', i) as string | number;
          if (costOverride !== '' && costOverride !== null && costOverride !== undefined) {
            body.cost_override = costOverride;
          }
          const externalId = this.getNodeParameter('eventExternalId', i) as string;
          if (externalId) body.external_id = externalId;
          const occurredAt = this.getNodeParameter('occurredAt', i) as string;
          if (occurredAt) body.occurred_at = occurredAt;
          const metadata = parseJsonParameter(
            this.getNodeParameter('eventMetadata', i),
            'Metadata',
            i,
          );
          if (metadata) body.metadata = metadata;
          await post(`${baseUrl}/api/v1/events`, body, i);
        });
      }
      return [out];
    }

    if (operation === 'resolveEvent') {
      for (let i = 0; i < items.length; i++) {
        await perItem(i, async () => {
          const eventId = String(this.getNodeParameter('eventId', i) ?? '').trim();
          if (!eventId) {
            throw new NodeOperationError(this.getNode(), 'Event ID is required.', {
              itemIndex: i,
            });
          }
          const body: Record<string, unknown> = {};
          const downtime = readMinutes('resolveDowntimeMinutes', 'Downtime (Minutes)', i);
          if (downtime !== undefined) body.downtime_minutes = downtime;
          await post(`${baseUrl}/api/v1/events/${encodeURIComponent(eventId)}/resolve`, body, i);
        });
      }
      return [out];
    }

    // Aggregate mode: one report per execution with units = the input item
    // count — the recommended after-a-loop pattern (all iterations of one
    // execution share an execution ID, so per-item reports dedupe to one
    // run anyway).
    const unitsFromItems = this.getNodeParameter('unitsFromItems', 0) as boolean;
    const indexes = unitsFromItems ? [0] : items.map((_item, i) => i);
    // The aggregate run derives from every input item, so both its response
    // and any validation error pair with all of them, not just item 0.
    const aggregatePairs = unitsFromItems
      ? items.map((_item, idx) => ({ item: idx }))
      : undefined;

    for (const i of indexes) {
      await perItem(
        i,
        async () => {
      const body: Record<string, unknown> = {
        automation: this.getNodeParameter('automation', i),
        status: this.getNodeParameter('status', i),
        source: 'n8n',
      };
      const duration = this.getNodeParameter('durationSeconds', i) as number;
      if (duration >= 0) body.duration_seconds = duration;
      if (unitsFromItems) {
        body.units = items.length;
      } else {
        const units = this.getNodeParameter('units', i) as number;
        if (units >= 0) body.units = units;
      }
      const externalId = this.getNodeParameter('externalId', i) as string;
      if (externalId) body.external_id = externalId;
      const executedAt = this.getNodeParameter('executedAt', i) as string;
      if (executedAt) body.executed_at = executedAt;
      if (body.status === 'failure') {
        const failureReason = this.getNodeParameter('failureReason', i) as string;
        if (failureReason) body.failure_reason = failureReason;
      }
      const ai = this.getNodeParameter('aiUsage', i) as {
        model?: string;
        inputTokens?: number;
        outputTokens?: number;
        cachedTokens?: number;
        billing?: string;
        cost?: string;
      };
      if (ai.model) {
        body.ai = {
          model: ai.model,
          input_tokens: ai.inputTokens ?? 0,
          output_tokens: ai.outputTokens ?? 0,
          cached_tokens: ai.cachedTokens ?? 0,
          ...(ai.billing ? { billing: ai.billing } : {}),
          ...(ai.cost ? { cost: ai.cost } : {}),
        };
      } else if (ai.inputTokens || ai.outputTokens || ai.cachedTokens) {
        throw new NodeOperationError(
          this.getNode(),
          'AI Usage needs a Model: tokens without one would book the run while silently dropping its AI cost.',
          { itemIndex: i },
        );
      }
      const usage = parseJsonParameter(this.getNodeParameter('usage', i), 'Metered Usage', i);
      if (usage) body.usage = usage;
      const metadata = parseJsonParameter(this.getNodeParameter('metadata', i), 'Metadata', i);
      if (metadata) body.metadata = metadata;

      await post(`${baseUrl}/api/v1/runs`, body, i, aggregatePairs ?? { item: i });
        },
        aggregatePairs ?? { item: i },
      );
    }
    return [out];
  }
}
