import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
  NodeConnectionType,
} from 'n8n-workflow';

export class LumaTrackTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'LumaTrack Trigger',
    name: 'lumaTrackTrigger',
    icon: { light: 'file:lumatrack.svg', dark: 'file:lumatrack.dark.svg' },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ") || "all events"}}',
    description:
      'Starts a workflow when LumaTrack sends a webhook event (held runs, period closes, and more)',
    defaults: { name: 'LumaTrack Trigger' },
    inputs: [],
    outputs: ['main' as NodeConnectionType],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName:
          'Register this trigger in LumaTrack under Settings, Webhooks: paste the webhook URL shown above, choose JSON, and copy the endpoint secret into this node. LumaTrack signs every delivery; unsigned or mis-signed posts are dropped.',
        name: 'setupNotice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Endpoint Secret',
        name: 'secret',
        type: 'string',
        typeOptions: { password: true },
        default: '',
        required: true,
        description:
          'The signing secret of the LumaTrack webhook endpoint; verifies X-LumaTrack-Signature (HMAC-SHA256 of the exact body bytes)',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        options: [
          { name: 'Alert Fired (Failure Spike or Volume Drop)', value: 'alert.fired' },
          { name: 'API Key Created', value: 'api_key.created' },
          { name: 'Period Closed', value: 'period.closed' },
          { name: 'Report Link Created', value: 'report_link.created' },
          { name: 'Run Held (Over Plan Cap)', value: 'run.held' },
          { name: 'Shared Cost Created', value: 'shared_cost.created' },
          { name: 'Webhook Created', value: 'webhook.created' },
        ],
        default: [],
        description:
          'Only start the workflow for these events; empty means every event the LumaTrack endpoint sends',
      },
    ],
		usableAsTool: true,
  };

  webhookMethods = {
    default: {
      // Registration is manual (LumaTrack Settings, Webhooks): there is no
      // remote resource to create or tear down, so these are no-ops that
      // keep n8n's activation lifecycle happy.
      async checkExists(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject();
    const response = this.getResponseObject();
    const secret = this.getNodeParameter('secret') as string;
    const events = this.getNodeParameter('events') as string[];

    const signature = String(request.headers['x-lumatrack-signature'] ?? '');
    // The signature covers the exact bytes sent; rawBody is what n8n
    // received before any JSON parsing.
    const rawBody = (request as unknown as { rawBody?: Buffer }).rawBody;
    const body: Buffer = rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const valid =
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) {
      response.status(401).json({ error: 'invalid signature' });
      return { noWebhookResponse: true };
    }

    const event = String(request.headers['x-lumatrack-event'] ?? '');
    if (events.length && !events.includes(event)) {
      // Acknowledged but filtered out: LumaTrack must not retry it.
      response.status(200).json({ ignored: event });
      return { noWebhookResponse: true };
    }

    return {
      workflowData: [this.helpers.returnJsonArray([request.body ?? {}])],
    };
  }
}
