export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

export interface HttpHeader {
  key: string;
  value: string;
  enabled: boolean;
}

export interface QueryParam {
  key: string;
  value: string;
  enabled: boolean;
}

export interface Request {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  queryParams: QueryParam[];
  body?: RequestBody;
  auth?: AuthConfig;
  collectionId?: string;
  folderId?: string;
  createdAt: number;
  updatedAt: number;
}

export type BodyType = 'none' | 'json' | 'xml' | 'form-data' | 'x-www-form-urlencoded' | 'raw' | 'binary';

export interface RequestBody {
  type: BodyType;
  content: string;
  formData?: FormDataItem[];
}

export interface FormDataItem {
  key: string;
  value: string;
  type: 'text' | 'file';
  enabled: boolean;
}

export type AuthType = 'none' | 'bearer' | 'basic' | 'api-key' | 'oauth2' | 'digest';

export interface AuthConfig {
  type: AuthType;
  bearer?: {
    token: string;
  };
  basic?: {
    username: string;
    password: string;
  };
  apiKey?: {
    key: string;
    value: string;
    addTo: 'header' | 'query';
  };
  oauth2?: {
    accessToken: string;
    tokenType: string;
    expiresIn?: number;
  };
}
