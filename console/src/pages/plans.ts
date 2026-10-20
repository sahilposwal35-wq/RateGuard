import { api, type PlanItem, type PolicyItem } from '../api.js';

export async function renderPlans(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Plans and policies</h1>
        <p class="description">Manage tiered rate limits, monthly quotas, and route routing rules</p>
      </div>
      <div>
        <button id="btn-show-create-plan" class="btn btn-primary btn-sm">Create plan</button>
      </div>
    </div>

    <!-- Feedback Notice -->
    <div id="plans-feedback" style="display: none;"></div>

    <div style="display: grid; grid-template-columns: 320px 1fr; gap: 24px; align-items: start;">
      <!-- Plans List Column -->
      <div class="panel" style="margin-bottom: 0;">
        <h2>Plans</h2>
        <div id="plans-list" style="margin-top: 12px;">
          <div class="state-loading">Loading plans...</div>
        </div>
      </div>

      <!-- Policies Column -->
      <div>
        <div class="panel" style="margin-bottom: 24px;">
          <div class="panel-header">
            <div>
              <h2 id="selected-plan-title">Select a plan</h2>
              <p class="help-text" id="selected-plan-desc">Choose a plan on the left to inspect and configure its policies</p>
            </div>
            <div>
              <button id="btn-show-create-policy" class="btn btn-secondary btn-sm" style="display: none;">Add policy</button>
            </div>
          </div>

          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Route pattern</th>
                  <th>Algorithm</th>
                  <th class="num">Limit</th>
                  <th class="num">Window s</th>
                  <th class="num">Burst</th>
                  <th>Fail mode</th>
                  <th>Shadow</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="policies-table-body">
                <tr>
                  <td colspan="8" class="state-empty">Select a plan from the list to view its policies</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Container for Dialogs -->
    <div id="modal-container"></div>
  `;

  let plans: PlanItem[] = [];
  let selectedPlanId: string | number | null = null;

  async function loadPlans(): Promise<void> {
    try {
      plans = await api.getPlans();
      const listEl = container.querySelector('#plans-list') as HTMLElement;
      if (!listEl) return;

      if (plans.length === 0) {
        listEl.innerHTML = `
          <div class="state-empty">
            <p>No plans created yet</p>
            <button id="btn-empty-create-plan" class="btn btn-secondary btn-sm" style="margin-top: 12px;">Create first plan</button>
          </div>
        `;
        listEl.querySelector('#btn-empty-create-plan')?.addEventListener('click', showCreatePlanModal);
        return;
      }

      listEl.innerHTML = plans.map((p) => {
        const isSelected = String(p.id) === String(selectedPlanId);
        const quotaDisplay = p.quota_limit !== null
          ? `${Number(p.quota_limit).toLocaleString()} units (${p.quota_mode === 'write_behind' ? 'write behind' : 'exact'})`
          : 'No monthly quota';

        return `
          <div class="plan-card" data-id="${p.id}" style="padding: 12px; border: 1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}; border-radius: var(--radius-sm); margin-bottom: 8px; cursor: pointer; background: ${isSelected ? 'var(--bg-hover)' : 'var(--bg-surface)'};">
            <div style="font-weight: 600; display: flex; justify-content: space-between;">
              <span>${escapeHtml(p.name)}</span>
              <span class="code-val" style="color: var(--text-secondary); font-size: 11px;">ID ${p.id}</span>
            </div>
            <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
              ${quotaDisplay}
            </div>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.plan-card').forEach((card) => {
        card.addEventListener('click', () => {
          const id = (card as HTMLElement).dataset.id;
          if (id) selectPlan(id);
        });
      });

      // Select first plan by default if none selected
      if (!selectedPlanId && plans.length > 0) {
        selectPlan(plans[0].id);
      }
    } catch (err: unknown) {
      showFeedback('error', err instanceof Error ? err.message : 'Failed to load plans');
    }
  }

  async function selectPlan(planId: string | number): Promise<void> {
    selectedPlanId = planId;
    const plan = plans.find(p => String(p.id) === String(planId));
    if (!plan) return;

    // Update list card highlighting
    container.querySelectorAll('.plan-card').forEach((el) => {
      const card = el as HTMLElement;
      if (card.dataset.id === String(planId)) {
        card.style.borderColor = 'var(--accent)';
        card.style.backgroundColor = 'var(--bg-hover)';
      } else {
        card.style.borderColor = 'var(--border-color)';
        card.style.backgroundColor = 'var(--bg-surface)';
      }
    });

    const titleEl = container.querySelector('#selected-plan-title');
    const descEl = container.querySelector('#selected-plan-desc');
    const addPolicyBtn = container.querySelector('#btn-show-create-policy') as HTMLElement;

    if (titleEl) titleEl.textContent = `Policies for ${plan.name}`;
    if (descEl) {
      const qText = plan.quota_limit !== null
        ? `${Number(plan.quota_limit).toLocaleString()} monthly quota with ${plan.quota_mode === 'write_behind' ? 'write behind' : 'exact'} mode`
        : 'No monthly quota attached to this plan';
      descEl.textContent = qText;
    }
    if (addPolicyBtn) addPolicyBtn.style.display = 'inline-flex';

    await loadPolicies(planId);
  }

  async function loadPolicies(planId: string | number): Promise<void> {
    const tbody = container.querySelector('#policies-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" class="state-loading">Loading policies...</td></tr>';

    try {
      const policies = await api.getPolicies(planId);
      if (policies.length === 0) {
        tbody.innerHTML = `
          <tr>
            <td colspan="8" class="state-empty">No policies configured for this plan. Add a policy to begin limiting routes.</td>
          </tr>
        `;
        return;
      }

      tbody.innerHTML = policies.map((pol) => {
        const algoDisplay = pol.algorithm.replace(/_/g, ' ');
        const burstDisplay = pol.burst !== null ? Number(pol.burst).toLocaleString() : 'None';
        const failDisplay = pol.fail_mode === 'open' ? 'fail open' : 'fail closed';
        const shadowDisplay = pol.shadow ? '<span class="badge badge-warning">Shadow</span>' : '<span class="badge badge-neutral">Active</span>';

        return `
          <tr>
            <td><span class="code-val">${escapeHtml(pol.route_pattern)}</span></td>
            <td>${algoDisplay}</td>
            <td class="num">${Number(pol.limit_units).toLocaleString()}</td>
            <td class="num">${Number(pol.window_seconds).toLocaleString()}</td>
            <td class="num">${burstDisplay}</td>
            <td>${failDisplay}</td>
            <td>${shadowDisplay}</td>
            <td>
              <button class="btn btn-secondary btn-sm delete-policy-btn" data-id="${pol.id}" data-pattern="${escapeHtml(pol.route_pattern)}">
                Delete
              </button>
            </td>
          </tr>
        `;
      }).join('');

      tbody.querySelectorAll('.delete-policy-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = (btn as HTMLElement).dataset.id;
          const pattern = (btn as HTMLElement).dataset.pattern;
          if (id && pattern) confirmDeletePolicy(id, pattern);
        });
      });
    } catch (err: unknown) {
      showFeedback('error', err instanceof Error ? err.message : 'Failed to load policies');
    }
  }

  function showFeedback(type: 'success' | 'error', message: string): void {
    const fb = container.querySelector('#plans-feedback') as HTMLElement;
    if (!fb) return;
    fb.className = `notice notice-${type}`;
    fb.textContent = message;
    fb.style.display = 'block';
    setTimeout(() => {
      fb.style.display = 'none';
    }, 5000);
  }

  function showCreatePlanModal(): void {
    const modal = container.querySelector('#modal-container') as HTMLElement;
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title">Create new plan</h2>
          <form id="create-plan-form" style="margin-top: 16px;">
            <div class="form-group">
              <label for="plan-name">Plan name</label>
              <input type="text" id="plan-name" class="input-text" required placeholder="For example standard or pro" />
              <div id="plan-name-err" class="input-error-msg" style="display: none;"></div>
            </div>

            <div class="form-group">
              <label for="plan-quota-limit">Monthly quota limit</label>
              <input type="number" id="plan-quota-limit" class="input-text" placeholder="Leave empty for unlimited" min="1" />
              <p class="help-text">Total requests permitted per calendar month in UTC</p>
            </div>

            <div class="form-group">
              <label for="plan-quota-mode">Quota mode</label>
              <select id="plan-quota-mode">
                <option value="exact">Exact (PostgreSQL row update, never over admits)</option>
                <option value="write_behind">Write behind (Redis counter with background flush, high throughput)</option>
              </select>
              <p class="help-text">Choose exact for zero tolerance or write behind for lower latency</p>
            </div>

            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
              <button type="submit" class="btn btn-primary" id="modal-submit-btn">Save plan</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = modal.querySelector('#create-plan-form') as HTMLFormElement;
    const cancelBtn = modal.querySelector('#modal-cancel-btn') as HTMLButtonElement;
    const nameInput = modal.querySelector('#plan-name') as HTMLInputElement;

    const closeModal = () => { modal.innerHTML = ''; };
    cancelBtn.addEventListener('click', closeModal);
    modal.querySelector('#modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      const limitRaw = (modal.querySelector('#plan-quota-limit') as HTMLInputElement).value.trim();
      const mode = (modal.querySelector('#plan-quota-mode') as HTMLSelectElement).value as 'exact' | 'write_behind';
      const quotaLimit = limitRaw ? parseInt(limitRaw, 10) : null;

      try {
        const created = await api.createPlan({ name, quota_limit: quotaLimit, quota_mode: mode });
        closeModal();
        showFeedback('success', `Plan ${created.name} created successfully`);
        await loadPlans();
        selectPlan(created.id);
      } catch (err: unknown) {
        const errEl = modal.querySelector('#plan-name-err') as HTMLElement;
        errEl.textContent = err instanceof Error ? err.message : 'Failed to create plan';
        errEl.style.display = 'block';
      }
    });

    nameInput.focus();
  }

  function showCreatePolicyModal(): void {
    if (!selectedPlanId) return;
    const plan = plans.find(p => String(p.id) === String(selectedPlanId));
    if (!plan) return;

    const modal = container.querySelector('#modal-container') as HTMLElement;
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h2 id="modal-title">Add policy for ${escapeHtml(plan.name)}</h2>
          <form id="create-policy-form" style="margin-top: 16px;">
            <div class="form-group">
              <label for="policy-route">Route pattern</label>
              <input type="text" id="policy-route" class="input-text input-mono" required placeholder="* or POST /v1/payments or /api/*" />
              <p class="help-text">Exact route match, prefix ending with asterisk, or asterisk for all routes</p>
              <div id="policy-route-err" class="input-error-msg" style="display: none;"></div>
            </div>

            <div class="form-group">
              <label for="policy-algo">Algorithm</label>
              <select id="policy-algo">
                <option value="token_bucket">Token bucket (allows burst up to capacity with steady refill)</option>
                <option value="fixed_window">Fixed window (simple counter resetting at window boundaries)</option>
                <option value="sliding_window">Sliding window (weighted estimate across window boundaries)</option>
              </select>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label for="policy-limit">Limit units</label>
                <input type="number" id="policy-limit" class="input-text" required min="1" placeholder="100" />
                <p class="help-text">Allowed request units in window</p>
              </div>

              <div class="form-group">
                <label for="policy-window">Window seconds</label>
                <input type="number" id="policy-window" class="input-text" required min="1" placeholder="60" />
                <p class="help-text">Window duration in seconds</p>
              </div>
            </div>

            <div class="form-group" id="burst-form-group">
              <label for="policy-burst">Burst capacity</label>
              <input type="number" id="policy-burst" class="input-text" min="1" placeholder="100" />
              <p class="help-text">Required for token bucket algorithm: maximum burst tokens held in bucket</p>
            </div>

            <div class="form-group">
              <label for="policy-fail-mode">Fail mode</label>
              <select id="policy-fail-mode">
                <option value="open">Fail open (allow requests with degraded flag if Redis fails)</option>
                <option value="closed">Fail closed (deny requests with error code if Redis fails)</option>
              </select>
              <p class="help-text">Determines system behaviour when rate storage is unavailable</p>
            </div>

            <div class="form-group">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: normal; cursor: pointer;">
                <input type="checkbox" id="policy-shadow" />
                Enable shadow mode
              </label>
              <p class="help-text">In shadow mode, decisions are evaluated and recorded but requests are never blocked</p>
            </div>

            <div class="modal-actions">
              <button type="button" class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
              <button type="submit" class="btn btn-primary" id="modal-submit-btn">Save policy</button>
            </div>
          </form>
        </div>
      </div>
    `;

    const form = modal.querySelector('#create-policy-form') as HTMLFormElement;
    const cancelBtn = modal.querySelector('#modal-cancel-btn') as HTMLButtonElement;
    const algoSelect = modal.querySelector('#policy-algo') as HTMLSelectElement;
    const burstGroup = modal.querySelector('#burst-form-group') as HTMLElement;
    const burstInput = modal.querySelector('#policy-burst') as HTMLInputElement;

    algoSelect.addEventListener('change', () => {
      if (algoSelect.value === 'token_bucket') {
        burstGroup.style.display = 'block';
        burstInput.required = true;
      } else {
        burstGroup.style.display = 'none';
        burstInput.required = false;
      }
    });

    const closeModal = () => { modal.innerHTML = ''; };
    cancelBtn.addEventListener('click', closeModal);
    modal.querySelector('#modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const route = (modal.querySelector('#policy-route') as HTMLInputElement).value.trim();
      const algorithm = algoSelect.value;
      const limitUnits = parseInt((modal.querySelector('#policy-limit') as HTMLInputElement).value, 10);
      const windowSeconds = parseInt((modal.querySelector('#policy-window') as HTMLInputElement).value, 10);
      const burst = algorithm === 'token_bucket' ? parseInt(burstInput.value, 10) : null;
      const failMode = (modal.querySelector('#policy-fail-mode') as HTMLSelectElement).value as 'open' | 'closed';
      const shadow = (modal.querySelector('#policy-shadow') as HTMLInputElement).checked;

      try {
        await api.createPolicy({
          plan_id: Number(selectedPlanId),
          route_pattern: route,
          algorithm,
          limit_units: limitUnits,
          window_seconds: windowSeconds,
          burst,
          fail_mode: failMode,
          shadow,
        });
        closeModal();
        showFeedback('success', `Policy for ${route} added successfully`);
        await loadPolicies(selectedPlanId!);
      } catch (err: unknown) {
        const errEl = modal.querySelector('#policy-route-err') as HTMLElement;
        errEl.textContent = err instanceof Error ? err.message : 'Failed to save policy';
        errEl.style.display = 'block';
      }
    });
  }

  function confirmDeletePolicy(id: string | number, routePattern: string): void {
    const modal = container.querySelector('#modal-container') as HTMLElement;
    modal.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-dialog" role="dialog" aria-modal="true">
          <h2>Confirm policy deletion</h2>
          <p style="margin-top: 12px;">Are you sure you want to delete policy for route pattern <span class="code-val">${escapeHtml(routePattern)}</span>? This action cannot be undone.</p>
          <div class="modal-actions">
            <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
            <button class="btn btn-danger" id="modal-confirm-delete-btn">Delete policy</button>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => { modal.innerHTML = ''; };
    modal.querySelector('#modal-cancel-btn')?.addEventListener('click', closeModal);
    modal.querySelector('#modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    modal.querySelector('#modal-confirm-delete-btn')?.addEventListener('click', async () => {
      try {
        await api.deletePolicy(id);
        closeModal();
        showFeedback('success', `Policy for ${routePattern} deleted successfully`);
        if (selectedPlanId) await loadPolicies(selectedPlanId);
      } catch (err: unknown) {
        closeModal();
        showFeedback('error', err instanceof Error ? err.message : 'Failed to delete policy');
      }
    });
  }

  container.querySelector('#btn-show-create-plan')?.addEventListener('click', showCreatePlanModal);
  container.querySelector('#btn-show-create-policy')?.addEventListener('click', showCreatePolicyModal);

  // Keyboard shortcut: Escape closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = container.querySelector('#modal-container');
      if (modal) modal.innerHTML = '';
    }
  });

  await loadPlans();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
