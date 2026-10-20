/**
 * RateGuard Admin API Client
 * Session token is stored strictly in memory, never in localStorage or sessionStorage.
 */

let inMemoryAdminToken: string | null = null;

export function setAdminToken(token: string): void {
  inMemoryAdminToken = token.trim();
}

export function getAdminToken(): string | null {
  return inMemoryAdminToken;
}

export function clearAdminToken(): void {
  inMemoryAdminToken = null;
}

export function isAuthenticated(): boolean {
  return inMemoryAdminToken !== null && inMemoryAdminToken.length > 0;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  
  if (inMemoryAdminToken) {
    headers.set('Authorization', `Bearer ${inMemoryAdminToken}`);
  }
  
  if (options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    // If unauthorized, token is invalid or expired
    throw new Error('Authentication required: invalid or missing admin token');
  }

  if (res.status === 204) {
    return {} as T;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data.message || `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export interface ReadyzResponse {
  status: 'ok' | 'degraded' | 'error';
  checks: {
    postgres?: string;
    redis?: string;
  };
  degraded: boolean;
}

export interface DecisionItem {
  timestamp: string;
  clientId: number | null;
  clientName: string | null;
  route: string;
  policyId: number | null;
  reason: string;
  allowed: boolean;
  latencyMs: number;
  algorithm: string | null;
  degraded: boolean;
  shadow: boolean;
  cost: number;
}

export interface PlanItem {
  id: string | number;
  name: string;
  quota_limit: string | number | null;
  quota_mode: 'exact' | 'write_behind';
}

export interface PolicyItem {
  id: string | number;
  plan_id: string | number;
  route_pattern: string;
  algorithm: 'token_bucket' | 'fixed_window' | 'sliding_window';
  limit_units: string | number;
  window_seconds: string | number;
  burst: string | number | null;
  fail_mode: 'open' | 'closed';
  shadow: boolean;
}

export interface ClientItem {
  id: string | number;
  name: string;
  plan_id: string | number;
  plan_name: string;
  created_at: string;
}

export interface ApiKeyItem {
  id: string | number;
  client_id: string | number;
  status: 'active' | 'revoked';
  created_at: string;
  api_key?: string; // only present upon issuance
}

export interface UsageResponse {
  client_id: number;
  client_name: string;
  plan_id: number;
  plan_name: string;
  period_start: string;
  quota_mode: 'exact' | 'write_behind';
  limit: number | null;
  used: number;
  remaining: number | null;
  loss_window_note: string | null;
}

export interface SettingsResponse {
  bypass: boolean;
  config_version: number;
  poll_interval_ms: number;
}

export const api = {
  // Readiness
  async getReadyz(): Promise<ReadyzResponse> {
    const res = await fetch('/readyz');
    return res.json();
  },

  // Decisions
  async getDecisions(): Promise<DecisionItem[]> {
    return request<DecisionItem[]>('/admin/v1/decisions');
  },

  // Bypass & Settings
  async getBypass(): Promise<{ bypass: boolean; config_version?: number }> {
    return request<{ bypass: boolean; config_version?: number }>('/admin/v1/bypass');
  },

  async getSettings(): Promise<SettingsResponse> {
    return request<SettingsResponse>('/admin/v1/settings');
  },

  async setBypass(enabled: boolean): Promise<{ bypass: boolean }> {
    return request<{ bypass: boolean }>('/admin/v1/bypass', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },

  // Plans
  async getPlans(): Promise<PlanItem[]> {
    return request<PlanItem[]>('/admin/v1/plans');
  },

  async createPlan(data: { name: string; quota_limit?: number | null; quota_mode: 'exact' | 'write_behind' }): Promise<PlanItem> {
    return request<PlanItem>('/admin/v1/plans', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePlan(id: string | number, data: { name?: string; quota_limit?: number | null; quota_mode?: 'exact' | 'write_behind' }): Promise<PlanItem> {
    return request<PlanItem>(`/admin/v1/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deletePlan(id: string | number): Promise<void> {
    return request<void>(`/admin/v1/plans/${id}`, { method: 'DELETE' });
  },

  // Policies
  async getPolicies(planId?: string | number): Promise<PolicyItem[]> {
    const query = planId ? `?plan_id=${planId}` : '';
    return request<PolicyItem[]>(`/admin/v1/policies${query}`);
  },

  async createPolicy(data: {
    plan_id: number;
    route_pattern: string;
    algorithm: string;
    limit_units: number;
    window_seconds: number;
    burst?: number | null;
    fail_mode: 'open' | 'closed';
    shadow: boolean;
  }): Promise<PolicyItem> {
    return request<PolicyItem>('/admin/v1/policies', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updatePolicy(id: string | number, data: Partial<PolicyItem>): Promise<PolicyItem> {
    return request<PolicyItem>(`/admin/v1/policies/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async deletePolicy(id: string | number): Promise<void> {
    return request<void>(`/admin/v1/policies/${id}`, { method: 'DELETE' });
  },

  // Clients
  async getClients(): Promise<ClientItem[]> {
    return request<ClientItem[]>('/admin/v1/clients');
  },

  async createClient(data: { name: string; plan_id: number }): Promise<ClientItem> {
    return request<ClientItem>('/admin/v1/clients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // API Keys
  async getClientKeys(clientId: string | number): Promise<ApiKeyItem[]> {
    return request<ApiKeyItem[]>(`/admin/v1/clients/${clientId}/api-keys`);
  },

  async issueApiKey(clientId: string | number): Promise<ApiKeyItem> {
    return request<ApiKeyItem>(`/admin/v1/clients/${clientId}/api-keys`, {
      method: 'POST',
    });
  },

  async revokeApiKey(keyId: string | number): Promise<ApiKeyItem> {
    return request<ApiKeyItem>(`/admin/v1/api-keys/${keyId}/revoke`, {
      method: 'POST',
    });
  },

  // Usage
  async getUsage(clientId: string | number): Promise<UsageResponse> {
    // Usage endpoint accepts service token or admin token
    return request<UsageResponse>(`/v1/usage/${clientId}`);
  },

  // Playground Check
  async checkRateLimit(apiKey: string, route: string, cost: number): Promise<any> {
    const res = await fetch('/v1/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        route,
        cost,
      }),
    });
    return res.json();
  },
};
