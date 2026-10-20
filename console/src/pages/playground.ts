import { api, type ClientItem, type ApiKeyItem } from '../api.js';

interface CheckResponse {
  allowed: boolean;
  reason: string;
  remaining: number;
  reset_ms: number;
  limit: number;
  shadow?: boolean;
  degraded?: boolean;
}

interface BurstResultItem {
  index: number;
  allowed: boolean;
  reason: string;
  remaining: number;
  reset_ms: number;
  latencyMs: number;
}

export async function renderPlayground(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Test playground</h1>
        <p class="description">Send live single checks or burst batches to test rate limiting policies</p>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 380px 1fr; gap: 24px; align-items: start;">
      <!-- Request Config Form -->
      <div class="panel">
        <h2>Request parameters</h2>

        <form id="playground-form" style="margin-top: 16px;">
          <div class="form-group">
            <label for="select-playground-client">Select client</label>
            <select id="select-playground-client" class="input-select">
              <option value="">Loading clients...</option>
            </select>
            <p class="help-text">Automatically picks an active API key for this client</p>
          </div>

          <div class="form-group">
            <label for="playground-api-key">API key secret</label>
            <input
              type="text"
              id="playground-api-key"
              class="input-text input-mono"
              placeholder="Paste or auto select an API key"
              required
            />
          </div>

          <div class="form-group">
            <label for="playground-route">HTTP method and route</label>
            <input
              type="text"
              id="playground-route"
              class="input-text input-mono"
              value="GET /v1/items"
              required
            />
            <p class="help-text">Example: GET /v1/items or POST /v1/messages</p>
          </div>

          <div class="form-group">
            <label for="playground-cost">Cost in units</label>
            <input
              type="number"
              id="playground-cost"
              class="input-text input-mono"
              value="1"
              min="1"
              max="1000"
              required
            />
          </div>

          <div style="margin-top: 24px; display: flex; flex-direction: column; gap: 12px;">
            <button type="submit" id="btn-send-single" class="btn btn-primary">
              Send single request
            </button>

            <div style="display: flex; gap: 8px; align-items: center;">
              <input
                type="number"
                id="burst-count"
                class="input-text input-mono"
                value="10"
                min="2"
                max="100"
                style="width: 80px;"
              />
              <button type="button" id="btn-send-burst" class="btn btn-secondary" style="flex: 1;">
                Send burst of requests
              </button>
            </div>
          </div>
        </form>
      </div>

      <!-- Live Results Column -->
      <div>
        <!-- One line summary panel -->
        <div class="panel" style="margin-bottom: 24px;">
          <h2>Decision summary</h2>
          <div id="summary-line-container" style="margin-top: 12px;">
            <div class="state-empty" style="padding: 16px 0;">
              No requests sent yet. Configure parameters and click Send above.
            </div>
          </div>
        </div>

        <!-- Burst Table (if burst sent) -->
        <div id="burst-panel" class="panel" style="display: none; margin-bottom: 24px;">
          <div class="panel-header">
            <h2>Burst batch details</h2>
            <span class="help-text" id="burst-summary-text"></span>
          </div>

          <div class="table-container" style="max-height: 260px; overflow-y: auto;">
            <table>
              <thead>
                <tr>
                  <th class="num">Request</th>
                  <th>Result</th>
                  <th>Reason</th>
                  <th class="num">Remaining</th>
                  <th class="num">Reset ms</th>
                  <th class="num">Latency ms</th>
                </tr>
              </thead>
              <tbody id="burst-table-body"></tbody>
            </table>
          </div>
        </div>

        <!-- Raw JSON Response -->
        <div class="panel">
          <div class="panel-header">
            <h2>Raw response body</h2>
            <span class="help-text" id="response-status-label">HTTP 200</span>
          </div>
          <pre id="raw-response-box" class="code-val" style="background: var(--bg-hover); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-color); max-height: 280px; overflow-y: auto; margin: 0; font-size: 13px;">Waiting for request...</pre>
        </div>
      </div>
    </div>
  `;

  const clientSelect = container.querySelector('#select-playground-client') as HTMLSelectElement;
  const apiKeyInput = container.querySelector('#playground-api-key') as HTMLInputElement;
  const routeInput = container.querySelector('#playground-route') as HTMLInputElement;
  const costInput = container.querySelector('#playground-cost') as HTMLInputElement;
  const burstCountInput = container.querySelector('#burst-count') as HTMLInputElement;
  const sendSingleBtn = container.querySelector('#btn-send-single') as HTMLButtonElement;
  const sendBurstBtn = container.querySelector('#btn-send-burst') as HTMLButtonElement;
  const summaryContainer = container.querySelector('#summary-line-container') as HTMLElement;
  const rawBox = container.querySelector('#raw-response-box') as HTMLElement;
  const burstPanel = container.querySelector('#burst-panel') as HTMLElement;
  const burstSummaryText = container.querySelector('#burst-summary-text') as HTMLElement;
  const burstTableBody = container.querySelector('#burst-table-body') as HTMLElement;
  const statusLabel = container.querySelector('#response-status-label') as HTMLElement;

  let clients: ClientItem[] = [];

  async function loadClients(): Promise<void> {
    try {
      clients = await api.getClients();
      if (clients.length === 0) {
        clientSelect.innerHTML = '<option value="">No clients found</option>';
        return;
      }

      clientSelect.innerHTML = `
        <option value="">Select a client to auto load key</option>
        ${clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)} (ID ${c.id})</option>`).join('')}
      `;
    } catch {
      clientSelect.innerHTML = '<option value="">Failed to load clients</option>';
    }
  }

  clientSelect.addEventListener('change', async () => {
    const clientId = clientSelect.value;
    if (!clientId) return;

    apiKeyInput.value = 'Looking for active key...';
    try {
      const keys = await api.getClientKeys(clientId);
      const activeKey = keys.find((k) => k.status === 'active');
      if (activeKey) {
        // If the key has api_key returned (e.g. newly issued), use it, otherwise alert
        if (activeKey.api_key) {
          apiKeyInput.value = activeKey.api_key;
        } else {
          // Since only hash is stored in DB, suggest issuing a new key if plain secret is forgotten
          apiKeyInput.value = '';
          apiKeyInput.placeholder = 'Paste active key secret (hash stored in database)';
        }
      } else {
        apiKeyInput.value = '';
        apiKeyInput.placeholder = 'No active keys found for this client. Issue one first.';
      }
    } catch {
      apiKeyInput.value = '';
      apiKeyInput.placeholder = 'Error loading keys for client';
    }
  });

  async function executeSingleCheck(): Promise<void> {
    const apiKey = apiKeyInput.value.trim();
    const route = routeInput.value.trim();
    const cost = Number(costInput.value) || 1;

    if (!apiKey) {
      alert('Please enter or select an API key');
      return;
    }

    sendSingleBtn.disabled = true;
    sendSingleBtn.textContent = 'Sending...';
    summaryContainer.innerHTML = '<div class="state-loading">Evaluating decision...</div>';
    burstPanel.style.display = 'none';

    const t0 = performance.now();
    try {
      const data = await api.checkRateLimit(apiKey, route, cost);
      const latency = Math.round((performance.now() - t0) * 100) / 100;
      renderSingleResult(data, latency);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      summaryContainer.innerHTML = `
        <div class="notice notice-error">
          <p>${escapeHtml(msg)}</p>
        </div>
      `;
      rawBox.textContent = msg;
      statusLabel.textContent = 'Error';
    } finally {
      sendSingleBtn.disabled = false;
      sendSingleBtn.textContent = 'Send single request';
    }
  }

  function renderSingleResult(res: CheckResponse, latencyMs: number): void {
    const isAllowed = res.allowed === true;
    const statusCode = isAllowed ? 200 : 429;
    statusLabel.textContent = `HTTP ${statusCode}`;

    // One line summary: 200 allowed or 429 denied with remaining and reset time
    const summaryBadge = isAllowed
      ? '<span class="status-badge status-ok">200 allowed</span>'
      : '<span class="status-badge status-warn">429 denied</span>';

    summaryContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
        <div style="display: flex; align-items: center; gap: 12px;">
          ${summaryBadge}
          <span style="font-weight: 500;">
            Reason: <span class="code-val">${escapeHtml(res.reason || 'ok')}</span>
          </span>
        </div>
        <div style="display: flex; gap: 16px; font-size: 13px;">
          <span>Remaining: <span class="code-val" style="font-weight: 600;">${res.remaining ?? 'N/A'}</span></span>
          <span>Reset in: <span class="code-val" style="font-weight: 600;">${res.reset_ms ?? 0} ms</span></span>
          <span style="color: var(--text-secondary);">Latency: <span class="code-val">${latencyMs} ms</span></span>
        </div>
      </div>
    `;

    rawBox.textContent = JSON.stringify(res, null, 2);
  }

  async function executeBurst(): Promise<void> {
    const apiKey = apiKeyInput.value.trim();
    const route = routeInput.value.trim();
    const cost = Number(costInput.value) || 1;
    const burstCount = Math.min(Math.max(Number(burstCountInput.value) || 10, 2), 100);

    if (!apiKey) {
      alert('Please enter or select an API key');
      return;
    }

    sendBurstBtn.disabled = true;
    sendBurstBtn.textContent = `Sending ${burstCount}...`;
    summaryContainer.innerHTML = `<div class="state-loading">Executing burst of ${burstCount} requests...</div>`;
    burstPanel.style.display = 'block';
    burstTableBody.innerHTML = '<tr><td colspan="6" class="state-loading">Dispatching requests...</td></tr>';

    const results: BurstResultItem[] = [];
    let lastRaw: any = null;

    for (let i = 1; i <= burstCount; i++) {
      const t0 = performance.now();
      try {
        const data = await api.checkRateLimit(apiKey, route, cost);
        const latency = Math.round((performance.now() - t0) * 100) / 100;
        lastRaw = data;
        results.push({
          index: i,
          allowed: data.allowed === true,
          reason: data.reason || 'ok',
          remaining: data.remaining ?? 0,
          reset_ms: data.reset_ms ?? 0,
          latencyMs: latency,
        });
      } catch (err: unknown) {
        results.push({
          index: i,
          allowed: false,
          reason: 'error',
          remaining: 0,
          reset_ms: 0,
          latencyMs: Math.round((performance.now() - t0) * 100) / 100,
        });
      }
    }

    const allowedCount = results.filter((r) => r.allowed).length;
    const deniedCount = results.length - allowedCount;

    burstSummaryText.textContent = `${allowedCount} allowed, ${deniedCount} denied of ${results.length} total`;

    summaryContainer.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="status-badge ${deniedCount > 0 ? 'status-warn' : 'status-ok'}">
            Burst batch finished
          </span>
          <span style="font-weight: 500;">
            ${allowedCount} allowed and ${deniedCount} denied
          </span>
        </div>
        <div style="font-size: 13px; color: var(--text-secondary);">
          Burst size: <span class="code-val">${results.length}</span>
        </div>
      </div>
    `;

    burstTableBody.innerHTML = results.map((r) => {
      const badge = r.allowed
        ? '<span class="status-badge status-ok">200 allowed</span>'
        : '<span class="status-badge status-warn">429 denied</span>';

      return `
        <tr>
          <td class="num">${r.index}</td>
          <td>${badge}</td>
          <td class="code-val">${escapeHtml(r.reason)}</td>
          <td class="num">${r.remaining}</td>
          <td class="num">${r.reset_ms}</td>
          <td class="num">${r.latencyMs}</td>
        </tr>
      `;
    }).join('');

    if (lastRaw) {
      rawBox.textContent = JSON.stringify(lastRaw, null, 2);
      statusLabel.textContent = `Last response: HTTP ${lastRaw.allowed ? 200 : 429}`;
    }

    sendBurstBtn.disabled = false;
    sendBurstBtn.textContent = 'Send burst of requests';
  }

  // Form submit
  container.querySelector('#playground-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    executeSingleCheck();
  });

  sendBurstBtn.addEventListener('click', () => {
    executeBurst();
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
