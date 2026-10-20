import { api, type SettingsResponse } from '../api.js';

export async function renderSettings(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Settings</h1>
        <p class="description">Global operational overrides and cluster synchronization parameters</p>
      </div>
      <div>
        <button id="btn-refresh-settings" class="btn btn-secondary btn-sm">Refresh</button>
      </div>
    </div>

    <!-- Notice banner -->
    <div id="settings-feedback" style="display: none;"></div>

    <!-- Settings Controls Panel -->
    <div class="panel" style="margin-bottom: 24px;">
      <h2>Global bypass switch</h2>
      <p class="help-text" style="margin-bottom: 20px;">
        When bypass is active, the decision engine allows all incoming requests without checking rate limits or quota counters.
      </p>

      <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px; background: var(--bg-hover); border-radius: var(--radius-sm); border: 1px solid var(--border-color);">
        <div>
          <div style="font-weight: 600; margin-bottom: 4px;">Bypass status</div>
          <div id="bypass-status-text" style="font-size: 13px; color: var(--text-secondary);">Loading status...</div>
        </div>
        <div>
          <button id="btn-toggle-bypass" class="btn btn-secondary" disabled>Toggle bypass</button>
        </div>
      </div>
    </div>

    <!-- Cluster Synchronization Panel -->
    <div class="panel">
      <h2>Cluster configuration</h2>
      <p class="help-text" style="margin-bottom: 20px;">
        State synchronization across distributed application instances
      </p>

      <div class="stats-row" style="margin-bottom: 20px;">
        <div class="stat-item">
          <div class="stat-label">Current config version</div>
          <div class="stat-value code-val" id="stat-config-version">Loading...</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Poll interval</div>
          <div class="stat-value code-val" id="stat-poll-interval">Loading...</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Propagation mechanism</div>
          <div class="stat-value" style="font-size: 15px; font-weight: normal; margin-top: 6px;">Atomic snapshot swap</div>
        </div>
      </div>

      <div class="notice notice-info">
        <p>
          Instances check the PostgreSQL config version table every 1000 ms. When an increment is detected, an atomic snapshot swap activates the new rules without process restart or downtime.
        </p>
      </div>
    </div>

    <!-- Modal Container for Confirmation Dialog -->
    <div id="modal-container"></div>
  `;

  const refreshBtn = container.querySelector('#btn-refresh-settings') as HTMLButtonElement;
  const toggleBtn = container.querySelector('#btn-toggle-bypass') as HTMLButtonElement;
  const statusText = container.querySelector('#bypass-status-text') as HTMLElement;
  const versionEl = container.querySelector('#stat-config-version') as HTMLElement;
  const pollEl = container.querySelector('#stat-poll-interval') as HTMLElement;
  const feedbackEl = container.querySelector('#settings-feedback') as HTMLElement;
  const modalContainer = container.querySelector('#modal-container') as HTMLElement;

  let currentSettings: SettingsResponse | null = null;

  async function loadSettings(): Promise<void> {
    try {
      currentSettings = await api.getSettings();

      const isBypass = currentSettings.bypass === true;
      statusText.innerHTML = isBypass
        ? '<span class="status-badge status-warn" style="font-weight: 600;">Active (all limits bypassed)</span>'
        : '<span class="status-badge status-ok" style="font-weight: 600;">Inactive (limits enforced)</span>';

      toggleBtn.disabled = false;
      toggleBtn.textContent = isBypass ? 'Disable bypass' : 'Enable bypass';
      if (isBypass) {
        toggleBtn.className = 'btn btn-secondary';
      } else {
        toggleBtn.className = 'btn btn-primary';
      }

      versionEl.textContent = `v${currentSettings.config_version}`;
      pollEl.textContent = `${currentSettings.poll_interval_ms} ms`;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to retrieve settings';
      showNotice(msg, 'error');
    }
  }

  function showNotice(message: string, type: 'success' | 'error'): void {
    feedbackEl.style.display = 'block';
    feedbackEl.innerHTML = `
      <div class="notice notice-${type}" style="margin-bottom: 24px;">
        <p>${escapeHtml(message)}</p>
      </div>
    `;
    setTimeout(() => {
      feedbackEl.style.display = 'none';
    }, 4000);
  }

  function confirmToggleBypass(): void {
    if (!currentSettings) return;

    const targetState = !currentSettings.bypass;
    const actionName = targetState ? 'Enable global bypass' : 'Disable global bypass';
    const message = targetState
      ? 'Enabling global bypass will allow all incoming requests to pass without rate limiting or quota checks. Are you sure you want to proceed?'
      : 'Disabling global bypass will resume enforcing all rate limit and quota policies across all routes. Are you sure you want to proceed?';

    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>${actionName}</h3>
          </div>
          <div class="modal-body">
            <p>${message}</p>

            <div class="modal-footer" style="margin-top: 24px; padding: 0;">
              <button type="button" id="btn-cancel-bypass" class="btn btn-secondary">Cancel</button>
              <button type="button" id="btn-confirm-bypass" class="${targetState ? 'btn btn-primary' : 'btn btn-primary'}">${actionName}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const cancelBtn = modalContainer.querySelector('#btn-cancel-bypass') as HTMLButtonElement;
    const confirmBtn = modalContainer.querySelector('#btn-confirm-bypass') as HTMLButtonElement;

    cancelBtn.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    confirmBtn.addEventListener('click', async () => {
      try {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Updating...';
        await api.setBypass(targetState);
        modalContainer.innerHTML = '';
        showNotice(`Global bypass ${targetState ? 'enabled' : 'disabled'} successfully`, 'success');
        await loadSettings();
      } catch (err: unknown) {
        modalContainer.innerHTML = '';
        showNotice(err instanceof Error ? err.message : 'Failed to update bypass', 'error');
      }
    });
  }

  toggleBtn.addEventListener('click', confirmToggleBypass);
  refreshBtn.addEventListener('click', loadSettings);

  await loadSettings();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
