import { LoginResponseDto, UserProfileDto } from '../../../shared/wms.contracts';
import { HttpClient, sharedHttpClient } from './HttpClient';

export class AuthApiService {
  constructor(private readonly client: HttpClient = sharedHttpClient) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const res = await this.client.post<LoginResponseDto>('/auth/login', { email, password });
    this.client.setToken(res.accessToken);
    return res;
  }

  async getCurrentUser(): Promise<UserProfileDto> {
    return this.client.get<UserProfileDto>('/auth/me');
  }

  logout(): void {
    this.client.setToken(null);
  }

  hasStoredToken(): boolean {
    return Boolean(this.client.getToken());
  }
}

export const authApiService = new AuthApiService();

