import { api, type ClientItem, type PlanItem, type ApiKeyItem } from '../api.js';

export async function renderClients(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Clients and API keys</h1>
        <p class="description">Manage registered tenant clients, plans, and active credentials</p>
      </div>
      <div>
        <button id="btn-show-create-client" class="btn btn-primary btn-sm">Create client</button>
      </div>
    </div>

    <div id="clients-feedback" style="display: none;"></div>

    <div style="display: grid; grid-template-columns: 360px 1fr; gap: 24px; align-items: start;">
      <!-- Clients Column -->
      <div class="panel" style="margin-bottom: 0;">
        <h2>Clients</h2>
        <div id="clients-list" style="margin-top: 12px;">
          <div class="state-loading">Loading clients...</div>
        </div>
      </div>

      <!-- Selected Client Details and API Keys Column -->
      <div>
        <div class="panel" style="margin-bottom: 24px;">
          <div class="panel-header">
            <div>
              <h2 id="selected-client-title">Select a client</h2>
              <p class="help-text" id="selected-client-desc">Choose a client from the list to view and manage API keys</p>
            </div>
            <div>
              <button id="btn-issue-key" class="btn btn-secondary btn-sm" style="display: none;">Issue new API key</button>
            </div>
          </div>

          <div id="selected-client-details" style="display: none; margin-bottom: 16px; padding: 12px; background: var(--bg-hover); border-radius: var(--radius-sm);">
            <div style="display: flex; gap: 24px; font-size: 13px;">
              <div>
                <span class="stat-label">Client ID</span>
                <div id="detail-client-id" class="code-val" style="font-weight: 600;"></div>
              </div>
              <div>
                <span class="stat-label">Assigned plan</span>
                <div id="detail-client-plan" style="font-weight: 600;"></div>
              </div>
              <div>
                <span class="stat-label">Created</span>
                <div id="detail-client-created" style="color: var(--text-secondary);"></div>
              </div>
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Key ID</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="keys-table-body">
                <tr>
                  <td colspan="4" class="state-empty">Select a client to inspect credentials</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Container -->
    <div id="modal-container"></div>
  `;

  let clients: ClientItem[] = [];
  let plans: PlanItem[] = [];
  let selectedClientId: string | number | null = null;

  async function loadInitialData(): Promise<void> {
    try {
      const [fetchedClients, fetchedPlans] = await Promise.all([
        api.getClients(),
        api.getPlans(),
      ]);
      clients = fetchedClients;
      plans = fetchedPlans;
      renderClientsList();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load clients';
      showNotice(msg, 'error');
    }
  }

  function showNotice(message: string, type: 'success' | 'error'): void {
    const el = container.querySelector('#clients-feedback') as HTMLElement;
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `
      <div class="notice notice-${type}">
        <p>${escapeHtml(message)}</p>
      </div>
    `;
    setTimeout(() => {
      el.style.display = 'none';
    }, 4000);
  }

  function renderClientsList(): void {
    const listEl = container.querySelector('#clients-list') as HTMLElement;
    if (!listEl) return;

    if (clients.length === 0) {
      listEl.innerHTML = `
        <div class="state-empty">
          <p>No clients registered yet</p>
          <button id="btn-empty-create-client" class="btn btn-secondary btn-sm" style="margin-top: 12px;">Create first client</button>
        </div>
      `;
      listEl.querySelector('#btn-empty-create-client')?.addEventListener('click', showCreateClientModal);
      return;
    }

    listEl.innerHTML = clients.map((c) => {
      const isSelected = String(c.id) === String(selectedClientId);
      return `
        <div class="client-card" data-id="${c.id}" style="padding: 12px; border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}; border-radius: var(--radius-sm); margin-bottom: 8px; cursor: pointer; background: ${isSelected ? 'var(--bg-hover)' : 'var(--bg-surface)'};">
          <div style="font-weight: 600; display: flex; justify-content: space-between;">
            <span>${escapeHtml(c.name)}</span>
            <span class="code-val" style="color: var(--text-secondary); font-size: 11px;">ID ${c.id}</span>
          </div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
            Plan: ${escapeHtml(c.plan_name || 'Standard')}
          </div>
        </div>
      `;
    }).join('');

    listEl.querySelectorAll('.client-card').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id;
        if (id) selectClient(id);
      });
    });

    if (!selectedClientId && clients.length > 0) {
      selectClient(clients[0].id);
    }
  }

  async function selectClient(clientId: string | number): Promise<void> {
    selectedClientId = clientId;
    const client = clients.find((c) => String(c.id) === String(clientId));
    if (!client) return;

    renderClientsList();

    const titleEl = container.querySelector('#selected-client-title') as HTMLElement;
    const descEl = container.querySelector('#selected-client-desc') as HTMLElement;
    const detailsBox = container.querySelector('#selected-client-details') as HTMLElement;
    const issueBtn = container.querySelector('#btn-issue-key') as HTMLElement;
    const idEl = container.querySelector('#detail-client-id') as HTMLElement;
    const planEl = container.querySelector('#detail-client-plan') as HTMLElement;
    const createdEl = container.querySelector('#detail-client-created') as HTMLElement;

    if (titleEl) titleEl.textContent = client.name;
    if (descEl) descEl.textContent = 'Active and revoked API credentials for this client';
    if (detailsBox) detailsBox.style.display = 'block';
    if (issueBtn) issueBtn.style.display = 'inline-block';

    if (idEl) idEl.textContent = String(client.id);
    if (planEl) planEl.textContent = client.plan_name || 'Standard';
    if (createdEl) {
      createdEl.textContent = client.created_at ? new Date(client.created_at).toLocaleString() : 'N/A';
    }

    await loadClientKeys(clientId);
  }

  async function loadClientKeys(clientId: string | number): Promise<void> {
    const tbody = container.querySelector('#keys-table-body') as HTMLElement;
    if (!tbody) return;

    tbody.innerHTML = `
      <tr>
        <td colspan="4" class="state-loading">Loading API keys...</td>
      </tr>
    `;

    try {
      const keys = await api.getClientKeys(clientId);
      if (keys.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" class="state-empty">No API keys issued for this client yet</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = keys.map((k) => {
        const isActive = k.status === 'active';
        const statusBadge = isActive
          ? '<span class="status-badge status-ok">active</span>'
          : '<span class="status-badge status-warn">revoked</span>';

        const actionBtn = isActive
          ? `<button class="btn btn-secondary btn-sm btn-revoke-key" data-key-id="${k.id}" style="color: var(--danger-color);">Revoke</button>`
          : '<span style="color: var(--text-secondary); font-size: 13px;">Revoked</span>';

        return `
          <tr>
            <td class="code-val">ID ${k.id}</td>
            <td>${statusBadge}</td>
            <td style="color: var(--text-secondary); font-size: 13px;">${new Date(k.created_at).toLocaleString()}</td>
            <td>${actionBtn}</td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.btn-revoke-key').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const keyId = (btn as HTMLElement).dataset.keyId;
          if (keyId) confirmRevokeKey(keyId);
        });
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load keys';
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="notice notice-error" style="margin: 8px;">${escapeHtml(msg)}</td>
        </tr>
      `;
    }
  }

  function showCreateClientModal(): void {
    const modalContainer = container.querySelector('#modal-container') as HTMLElement;
    if (!modalContainer) return;

    if (plans.length === 0) {
      showNotice('Please create a plan first before adding clients', 'error');
      return;
    }

    const planOptions = plans.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');

    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>Create client</h3>
          </div>
          <div class="modal-body">
            <form id="create-client-form">
              <div class="form-group">
                <label for="client-name">Client name</label>
                <input type="text" id="client-name" class="input-text" placeholder="Example Customer" required />
              </div>

              <div class="form-group">
                <label for="client-plan-id">Assigned plan</label>
                <select id="client-plan-id" class="input-select" required>
                  ${planOptions}
                </select>
              </div>

              <div id="modal-form-error" class="input-error-msg" style="display: none;"></div>

              <div class="modal-footer" style="padding: 16px 0 0 0;">
                <button type="button" id="btn-cancel-modal" class="btn btn-secondary">Cancel</button>
                <button type="submit" id="btn-submit-client" class="btn btn-primary">Create client</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    const form = modalContainer.querySelector('#create-client-form') as HTMLFormElement;
    const cancelBtn = modalContainer.querySelector('#btn-cancel-modal') as HTMLButtonElement;
    const errorEl = modalContainer.querySelector('#modal-form-error') as HTMLElement;

    cancelBtn.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.style.display = 'none';

      const name = (form.querySelector('#client-name') as HTMLInputElement).value.trim();
      const planId = Number((form.querySelector('#client-plan-id') as HTMLSelectElement).value);

      try {
        const newClient = await api.createClient({ name, plan_id: planId });
        modalContainer.innerHTML = '';
        showNotice(`Client ${newClient.name} created successfully`, 'success');
        await loadInitialData();
        selectClient(newClient.id);
      } catch (err: unknown) {
        errorEl.textContent = err instanceof Error ? err.message : 'Failed to create client';
        errorEl.style.display = 'block';
      }
    });
  }

  async function handleIssueKey(): Promise<void> {
    if (!selectedClientId) return;
    const modalContainer = container.querySelector('#modal-container') as HTMLElement;
    if (!modalContainer) return;

    try {
      const result = await api.issueApiKey(selectedClientId);
      const secret = result.api_key || 'Secret not available';

      modalContainer.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal-dialog">
            <div class="modal-header">
              <h3>API key issued</h3>
            </div>
            <div class="modal-body">
              <div class="notice notice-warn" style="margin-bottom: 16px;">
                <p>Store this secret safely. You cannot retrieve it again.</p>
              </div>

              <div class="form-group">
                <label>Key ID</label>
                <div class="code-val" style="margin-bottom: 8px;">ID ${result.id}</div>
              </div>

              <div class="form-group">
                <label>API key secret</label>
                <div style="display: flex; gap: 8px;">
                  <input type="text" id="issued-key-input" class="input-text input-mono" value="${secret}" readonly />
                  <button type="button" id="btn-copy-key" class="btn btn-secondary">Copy</button>
                </div>
              </div>

              <div class="modal-footer" style="padding: 16px 0 0 0;">
                <button type="button" id="btn-close-issued" class="btn btn-primary">Done</button>
              </div>
            </div>
          </div>
        </div>
      `;

      const copyBtn = modalContainer.querySelector('#btn-copy-key') as HTMLButtonElement;
      const keyInput = modalContainer.querySelector('#issued-key-input') as HTMLInputElement;
      const closeBtn = modalContainer.querySelector('#btn-close-issued') as HTMLButtonElement;

      copyBtn.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(keyInput.value);
          } else {
            keyInput.select();
            document.execCommand('copy');
          }
        } catch {
          keyInput.select();
        }
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 2000);
      });

      closeBtn.addEventListener('click', () => {
        modalContainer.innerHTML = '';
        loadClientKeys(selectedClientId!);
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to issue API key';
      showNotice(msg, 'error');
    }
  }

  function confirmRevokeKey(keyId: string | number): void {
    const modalContainer = container.querySelector('#modal-container') as HTMLElement;
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal-dialog">
          <div class="modal-header">
            <h3>Revoke API key</h3>
          </div>
          <div class="modal-body">
            <p>Are you sure you want to revoke API key ID ${keyId}? Any incoming requests using this key will immediately be denied.</p>

            <div class="modal-footer" style="margin-top: 24px; padding: 0;">
              <button type="button" id="btn-cancel-revoke" class="btn btn-secondary">Cancel</button>
              <button type="button" id="btn-confirm-revoke" class="btn btn-danger">Revoke key</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const cancelBtn = modalContainer.querySelector('#btn-cancel-revoke') as HTMLButtonElement;
    const confirmBtn = modalContainer.querySelector('#btn-confirm-revoke') as HTMLButtonElement;

    cancelBtn.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    confirmBtn.addEventListener('click', async () => {
      try {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Revoking...';
        await api.revokeApiKey(keyId);
        modalContainer.innerHTML = '';
        showNotice(`API key ID ${keyId} revoked`, 'success');
        if (selectedClientId) {
          loadClientKeys(selectedClientId);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to revoke API key';
        showNotice(msg, 'error');
        modalContainer.innerHTML = '';
      }
    });
  }

  // Bind top level buttons
  container.querySelector('#btn-show-create-client')?.addEventListener('click', showCreateClientModal);
  container.querySelector('#btn-issue-key')?.addEventListener('click', handleIssueKey);

  await loadInitialData();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
