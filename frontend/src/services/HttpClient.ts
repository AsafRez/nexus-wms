export class ApiRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/**
 * Base Object-Oriented HTTP Client.
 * Can be reused directly in a future React Native / Mobile client.
 */
export class HttpClient {
  private static readonly TOKEN_STORAGE_KEY = 'wms_access_token';
  private readonly baseUrl: string;

  constructor(baseUrl = '/api') {
    this.baseUrl = baseUrl;
  }

  public getToken(): string | null {
    return localStorage.getItem(HttpClient.TOKEN_STORAGE_KEY);
  }

  public setToken(token: string | null): void {
    if (token) {
      localStorage.setItem(HttpClient.TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(HttpClient.TOKEN_STORAGE_KEY);
    }
  }

  public async get<T>(endpoint: string): Promise<T> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  public async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  private async request<T>(endpoint: string, options: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errMsg = `Request failed (${response.status})`;
      try {
        const data = await response.json();
        if (Array.isArray(data.message)) {
          errMsg = data.message.join(', ');
        } else if (typeof data.message === 'string') {
          errMsg = data.message;
        }
      } catch {
        // fallback to status text
      }
      throw new ApiRequestError(response.status, errMsg);
    }

    return response.json() as Promise<T>;
  }
}

export const sharedHttpClient = new HttpClient('/api');

