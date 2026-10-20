import { api, type ClientItem, type UsageResponse } from '../api.js';

export async function renderUsage(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Quota and usage</h1>
        <p class="description">Monitor monthly request quota consumption and synchronization mode</p>
      </div>
      <div>
        <button id="btn-refresh-usage" class="btn btn-secondary btn-sm">Refresh</button>
      </div>
    </div>

    <!-- Client selector panel -->
    <div class="panel" style="margin-bottom: 24px;">
      <div style="display: flex; gap: 16px; align-items: flex-end; max-width: 600px;">
        <div class="form-group" style="flex: 1; margin-bottom: 0;">
          <label for="select-usage-client">Select tenant client</label>
          <select id="select-usage-client" class="input-select">
            <option value="">Loading clients...</option>
          </select>
        </div>
      </div>
    </div>

    <!-- Usage Details View -->
    <div id="usage-details-container">
      <div class="state-empty">
        Select a client above to view quota usage
      </div>
    </div>
  `;

  const clientSelect = container.querySelector('#select-usage-client') as HTMLSelectElement;
  const detailsContainer = container.querySelector('#usage-details-container') as HTMLElement;
  const refreshBtn = container.querySelector('#btn-refresh-usage') as HTMLButtonElement;

  let clients: ClientItem[] = [];

  async function loadClients(): Promise<void> {
    try {
      clients = await api.getClients();
      if (clients.length === 0) {
        clientSelect.innerHTML = '<option value="">No clients available</option>';
        detailsContainer.innerHTML = '<div class="state-empty">No clients found in the system</div>';
        return;
      }

      clientSelect.innerHTML = `
        <option value="">Choose a client</option>
        ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (ID ${c.id})</option>`).join('')}
      `;

      // Select first client by default
      if (clients.length > 0) {
        clientSelect.value = String(clients[0].id);
        await loadClientUsage(clients[0].id);
      }
    } catch (err: unknown) {
      clientSelect.innerHTML = '<option value="">Failed to load clients</option>';
      const msg = err instanceof Error ? err.message : 'Error loading clients';
      detailsContainer.innerHTML = `<div class="notice notice-error"><p>${escapeHtml(msg)}</p></div>`;
    }
  }

  async function loadClientUsage(clientId: string | number): Promise<void> {
    if (!clientId) {
      detailsContainer.innerHTML = '<div class="state-empty">Select a client above to view quota usage</div>';
      return;
    }

    detailsContainer.innerHTML = '<div class="state-loading">Fetching usage data from server...</div>';

    try {
      const usage: UsageResponse = await api.getUsage(clientId);
      renderUsageDetails(usage);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve usage data';
      detailsContainer.innerHTML = `
        <div class="notice notice-error">
          <p>${escapeHtml(msg)}</p>
        </div>
      `;
    }
  }

  function renderUsageDetails(usage: UsageResponse): void {
    const isWriteBehind = usage.quota_mode === 'write_behind';
    const quotaModeLabel = isWriteBehind ? 'write behind' : 'exact';

    const hasLimit = usage.limit !== null && usage.limit > 0;
    const limitDisplay = hasLimit ? `${Number(usage.limit).toLocaleString()} units` : 'Unlimited';
    const usedDisplay = `${Number(usage.used).toLocaleString()} units`;
    const remainingDisplay = hasLimit && usage.remaining !== null
      ? `${Number(usage.remaining).toLocaleString()} units`
      : 'Unlimited';

    const percentUsed = hasLimit && usage.limit ? Math.min(Math.round((usage.used / usage.limit) * 100), 100) : 0;

    const lossWindowNote = isWriteBehind
      ? `
        <div class="notice notice-info" style="margin-top: 24px;">
          <p>
            Write behind mode flushes counts every 5 seconds. Up to 5 seconds of counts may be buffered in Redis before persisting to PostgreSQL.
          </p>
        </div>
      `
      : `
        <div class="notice notice-info" style="margin-top: 24px;">
          <p>
            Exact mode updates quota synchronously in PostgreSQL with conditional queries. Every admitted request guarantees immediate counter durability.
          </p>
        </div>
      `;

    detailsContainer.innerHTML = `
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>${escapeHtml(usage.client_name)}</h2>
            <p class="help-text">Assigned plan: ${escapeHtml(usage.plan_name)} (ID ${usage.plan_id})</p>
          </div>
          <div>
            <span class="status-badge status-ok">Quota mode: ${quotaModeLabel}</span>
          </div>
        </div>

        <!-- Stats Grid -->
        <div class="stats-row" style="margin-bottom: 24px;">
          <div class="stat-item">
            <div class="stat-label">Period quota limit</div>
            <div class="stat-value code-val" style="font-size: 20px;">${limitDisplay}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Units consumed</div>
            <div class="stat-value code-val" style="font-size: 20px;">${usedDisplay}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Units remaining</div>
            <div class="stat-value code-val" style="font-size: 20px;">${remainingDisplay}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">Period start</div>
            <div class="stat-value" style="font-size: 15px; font-weight: normal; color: var(--text-secondary); margin-top: 6px;">
              ${usage.period_start ? new Date(usage.period_start).toLocaleDateString() : 'Current month'}
            </div>
          </div>
        </div>

        <!-- Meter bar if quota limit exists -->
        ${hasLimit ? `
          <div style="margin-top: 16px;">
            <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px;">
              <span class="stat-label">Quota consumption</span>
              <span class="code-val">${percentUsed}%</span>
            </div>
            <div style="width: 100%; height: 8px; background: var(--bg-hover); border-radius: 4px; overflow: hidden; border: 1px solid var(--border-color);">
              <div style="width: ${percentUsed}%; height: 100%; background: ${percentUsed >= 90 ? 'var(--danger-color)' : 'var(--accent)'}; transition: width 0.3s ease;"></div>
            </div>
          </div>
        ` : ''}

        ${lossWindowNote}
      </div>
    `;
  }

  clientSelect.addEventListener('change', () => {
    loadClientUsage(clientSelect.value);
  });

  refreshBtn.addEventListener('click', () => {
    if (clientSelect.value) {
      loadClientUsage(clientSelect.value);
    }
  });

  await loadClients();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
