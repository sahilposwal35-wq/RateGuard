import { api, type PolicyItem, type DecisionItem } from '../api.js';

export async function renderShadow(container: HTMLElement): Promise<void> {
  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>Shadow mode report</h1>
        <p class="description">Audit rules evaluated in observation mode without blocking callers</p>
      </div>
      <div>
        <button id="btn-refresh-shadow" class="btn btn-secondary btn-sm">Refresh</button>
      </div>
    </div>

    <!-- Stats Summary Row -->
    <div class="stats-row" style="margin-bottom: 24px;">
      <div class="stat-item">
        <div class="stat-label">Active shadow policies</div>
        <div class="stat-value code-val" id="stat-shadow-policies">0</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Evaluated decisions</div>
        <div class="stat-value code-val" id="stat-shadow-total">0</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Would be denied</div>
        <div class="stat-value code-val" id="stat-shadow-denied" style="color: var(--danger-color);">0</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Would be allowed</div>
        <div class="stat-value code-val" id="stat-shadow-allowed" style="color: var(--accent);">0</div>
      </div>
    </div>

    <!-- Active Shadow Policies Panel -->
    <div class="panel" style="margin-bottom: 24px;">
      <h2>Policies in shadow mode</h2>
      <p class="help-text" style="margin-bottom: 16px;">These policies record decisions and metrics but allow all traffic through</p>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Route pattern</th>
              <th>Plan ID</th>
              <th>Algorithm</th>
              <th class="num">Limit</th>
              <th class="num">Window s</th>
              <th>Fail mode</th>
            </tr>
          </thead>
          <tbody id="shadow-policies-table-body">
            <tr>
              <td colspan="6" class="state-loading">Loading shadow policies...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Shadow Decisions Stream Panel -->
    <div class="panel">
      <h2>Recent shadow decisions</h2>
      <p class="help-text" style="margin-bottom: 16px;">Real decisions captured where shadow evaluation was performed</p>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Route</th>
              <th>Theoretical result</th>
              <th>Reason code</th>
              <th class="num">Latency ms</th>
            </tr>
          </thead>
          <tbody id="shadow-decisions-table-body">
            <tr>
              <td colspan="6" class="state-loading">Loading decision stream...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  const refreshBtn = container.querySelector('#btn-refresh-shadow') as HTMLButtonElement;
  const statPolicies = container.querySelector('#stat-shadow-policies') as HTMLElement;
  const statTotal = container.querySelector('#stat-shadow-total') as HTMLElement;
  const statDenied = container.querySelector('#stat-shadow-denied') as HTMLElement;
  const statAllowed = container.querySelector('#stat-shadow-allowed') as HTMLElement;
  const policiesTbody = container.querySelector('#shadow-policies-table-body') as HTMLElement;
  const decisionsTbody = container.querySelector('#shadow-decisions-table-body') as HTMLElement;

  async function loadData(): Promise<void> {
    try {
      const [policies, decisions] = await Promise.all([
        api.getPolicies(),
        api.getDecisions(),
      ]);

      const shadowPolicies = policies.filter((p) => p.shadow === true);
      const shadowDecisions = decisions.filter((d) => d.shadow === true);

      // Denied requests are those where reason indicates rate limiting or quota exhaustion
      const wouldDeny = shadowDecisions.filter(
        (d) => d.reason === 'rate_limited' || d.reason === 'quota_exceeded'
      );
      const wouldAllow = shadowDecisions.filter(
        (d) => d.reason === 'ok' || d.reason === 'fail_open'
      );

      statPolicies.textContent = String(shadowPolicies.length);
      statTotal.textContent = String(shadowDecisions.length);
      statDenied.textContent = String(wouldDeny.length);
      statAllowed.textContent = String(wouldAllow.length);

      // Render Policies Table
      if (shadowPolicies.length === 0) {
        policiesTbody.innerHTML = `
          <tr>
            <td colspan="6" class="state-empty">No policies currently have shadow mode enabled</td>
          </tr>
        `;
      } else {
        policiesTbody.innerHTML = shadowPolicies.map((p) => `
          <tr>
            <td class="code-val">${escapeHtml(p.route_pattern)}</td>
            <td class="code-val">Plan ${p.plan_id}</td>
            <td>${escapeHtml(p.algorithm.replace('_', ' '))}</td>
            <td class="num">${p.limit_units}</td>
            <td class="num">${p.window_seconds}</td>
            <td>${p.fail_mode === 'open' ? 'fail open' : 'fail closed'}</td>
          </tr>
        `).join('');
      }

      // Render Decisions Table
      if (shadowDecisions.length === 0) {
        decisionsTbody.innerHTML = `
          <tr>
            <td colspan="6" class="state-empty">No decisions evaluated under shadow mode yet</td>
          </tr>
        `;
      } else {
        decisionsTbody.innerHTML = shadowDecisions.map((d) => {
          const isTheoreticalDeny = d.reason === 'rate_limited' || d.reason === 'quota_exceeded';
          const theoreticalBadge = isTheoreticalDeny
            ? '<span class="status-badge status-warn">Would deny</span>'
            : '<span class="status-badge status-ok">Would allow</span>';

          const timeStr = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : 'N/A';

          return `
            <tr>
              <td class="code-val" style="color: var(--text-secondary);">${timeStr}</td>
              <td>${escapeHtml(d.clientName || (d.clientId ? `Client ${d.clientId}` : 'Unknown'))}</td>
              <td class="code-val">${escapeHtml(d.route)}</td>
              <td>${theoreticalBadge}</td>
              <td><span class="code-val">${escapeHtml(d.reason)}</span></td>
              <td class="num">${d.latencyMs.toFixed(2)}</td>
            </tr>
          `;
        }).join('');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load shadow report';
      policiesTbody.innerHTML = `<tr><td colspan="6" class="notice notice-error">${escapeHtml(msg)}</td></tr>`;
      decisionsTbody.innerHTML = `<tr><td colspan="6" class="notice notice-error">${escapeHtml(msg)}</td></tr>`;
    }
  }

  refreshBtn.addEventListener('click', loadData);
  await loadData();
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
