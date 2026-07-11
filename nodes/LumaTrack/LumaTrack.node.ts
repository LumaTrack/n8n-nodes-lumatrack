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
    subtitle: '={{$parameter["operation"] === "getSummary" ? "Get ROI Summary" : $parameter["automation"]}}',
    description: 'Record automation run events in LumaTrack, or read the value summary',
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
            name: 'Record Run',
            value: 'recordRun',
            action: 'Record a run event',
            description: 'Report one execution (success or failure) to the value ledger',
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
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
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
      return value && Object.keys(value as object).length ? value : undefined;
    };

    // Aggregate mode: one report per execution with units = the input item
    // count — the recommended after-a-loop pattern (all iterations of one
    // execution share an execution ID, so per-item reports dedupe to one
    // run anyway).
    const unitsFromItems = this.getNodeParameter('unitsFromItems', 0) as boolean;
    const indexes = unitsFromItems ? [0] : items.map((_item, i) => i);

    for (const i of indexes) {
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

      try {
        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'lumaTrackApi',
          {
            method: 'POST',
            url: `${baseUrl}/api/v1/runs`,
            body,
            json: true,
          },
        );
        out.push({ json: response, pairedItem: { item: i } });
      } catch (requestError) {
        // A LumaTrack outage must not fail the host workflow when the user
        // opted into Continue On Fail (docs tell them to wire error paths).
        if (this.continueOnFail()) {
          out.push({
            json: { error: (requestError as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        throw new NodeApiError(this.getNode(), requestError as JsonObject);
      }
    }
    return [out];
  }
}
