type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';

interface RequestOptions {
  method?: HttpMethod;
  params?: Record<string, any>;
  headers?: Record<string, string>;
  body?: any;
  expectedStatus?: number | number[];
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer';
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  withCredentials?: boolean;
  validateStatus?: (status: number) => boolean;
}

interface ResponseData<T> {
  data: T;
  code: number;
  message: string;
  headers: Headers;
  config: RequestOptions;
  request: Request;
}

interface ResponseResult<T> {
  data: T;
  code: number;
  message: string;
  error: string | null;
}

class RequestError extends Error {
  constructor(
    public response: ResponseData<any>,
    public request: Request,
    public config: RequestOptions,
  ) {
    super(`HTTP Error ${response.code}: ${response.message}`);
    this.name = 'RequestError';
  }
}

const defaultStatusValidator = (code: number) => code >= 200 && code < 300;

async function request<T>(url: string, options: RequestOptions = {}): Promise<ResponseResult<T>> {
  const {
    method = 'GET',
    params,
    headers = {},
    body,
    expectedStatus,
    responseType = 'json',
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
    withCredentials = false,
    validateStatus = defaultStatusValidator,
  } = options;

  const requestOptions: RequestInit = {
    method,
    headers: {
      ...headers,
    },
    credentials: withCredentials ? 'include' : 'same-origin',
  };

  if (body) {
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      if (body instanceof FormData) {
        requestOptions.body = body;
      } else if (body instanceof URLSearchParams) {
        requestOptions.body = body;
        (requestOptions.headers as Record<string, string>)['content-type'] =
          'application/x-www-form-urlencoded';
      } else if (typeof body === 'object') {
        (requestOptions.headers as Record<string, string>)['content-type'] = 'application/json';
        requestOptions.body = JSON.stringify(body);
      } else {
        requestOptions.body = body;
      }
    } else {
      throw new Error('Request body is only supported for POST, PUT, and PATCH methods');
    }
  }

  let requestUrl = url;
  if (params) {
    const queryParams = new URLSearchParams(params);
    requestUrl += (url.includes('?') ? '&' : '?') + queryParams.toString();
  }

  const controller = new AbortController();
  requestOptions.signal = controller.signal;

  const timeoutId = setTimeout(() => controller.abort(), timeout);

  async function attemptFetch(): Promise<ResponseResult<T>> {
    const req = new Request(requestUrl, requestOptions);

    try {
      const res = await fetch(req);

      let responseData: T;
      switch (responseType) {
        case 'json':
          responseData = await res.json();
          break;
        case 'text':
          responseData = (await res.text()) as unknown as T;
          break;
        case 'blob':
          responseData = (await res.blob()) as unknown as T;
          break;
        case 'arrayBuffer':
          responseData = (await res.arrayBuffer()) as unknown as T;
          break;
        default:
          throw new Error(`Invalid responseType: ${responseType}`);
      }

      const response: ResponseData<T> = {
        data: responseData,
        code: res.status,
        message: res.statusText,
        headers: res.headers,
        config: options,
        request: req,
      };

      if (!validateStatus(res.status)) {
        throw new RequestError(response, req, options);
      }

      if (expectedStatus) {
        const expectedStatusArray = Array.isArray(expectedStatus)
          ? expectedStatus
          : [expectedStatus];
        if (!expectedStatusArray.includes(res.status)) {
          throw new RequestError(response, req, options);
        }
      }

      clearTimeout(timeoutId);

      return {
        data: responseData,
        code: res.status,
        message: res.statusText,
        error: null,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        return {
          data: null as unknown as T,
          code: 0,
          message: `Request timed out after ${timeout}ms`,
          error: `Request timed out after ${timeout}ms`,
        };
      }
      throw error;
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await attemptFetch();
      return result;
    } catch (error: any) {
      if (attempt === retries || (error instanceof RequestError && error.response.code < 500)) {
        return {
          data: null as unknown as T,
          code: error.response ? error.response.code : 0,
          message: error.response ? error.response.message : error.message,
          error: error.message,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }

  // This line should never be reached due to the throw in the loop above
  throw new Error('Unexpected error occurred');
}

// Convenience methods
const fetchGet = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'GET' });
const fetchPost = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'POST' });
const fetchPut = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'PUT' });
const fetchDelete = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'DELETE' });
const fetchPatch = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'PATCH' });
const fetchHead = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'HEAD' });
const fetchOptions = <T>(url: string, options?: RequestOptions) =>
  request<T>(url, { ...options, method: 'OPTIONS' });

export {
  RequestError,
  fetchDelete,
  fetchGet,
  fetchHead,
  fetchOptions,
  fetchPatch,
  fetchPost,
  fetchPut,
  request,
};
export type { HttpMethod, RequestOptions, ResponseData };
