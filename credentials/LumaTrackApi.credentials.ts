import type {
  IAuthenticateGeneric,
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

export class LumaTrackApi implements ICredentialType {
  name = 'lumaTrackApi';
  displayName = 'LumaTrack API';
  icon: Icon = { light: 'file:lumatrack.svg', dark: 'file:lumatrack.dark.svg' };
  documentationUrl = 'https://lumatrack.io/docs/integrations/n8n/';
  properties: INodeProperties[] = [
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: '',
      placeholder: 'https://your-lumatrack-host',
      required: true,
    },
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Org-scoped key from Settings, API keys',
    },
  ];
  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  };
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/summary',
    },
  };
}
