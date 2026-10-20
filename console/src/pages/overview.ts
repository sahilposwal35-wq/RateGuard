import { api, type DecisionItem, type ReadyzResponse } from '../api.js';

let refreshTimer: ReturnType<typeof setInterval> | null = null;

export async function renderOverview(container: HTMLElement): Promise<void> {
  // Clear any existing refresh interval
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  container.innerHTML = `
    <div class="panel-header">
      <div>
        <h1>System overview</h1>
        <p class="description">Live operational health, rate state, and recent decision stream</p>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <label style="display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: normal; cursor: pointer; margin: 0;">
          <input type="checkbox" id="auto-refresh-toggle" />
          Auto refresh every 3 seconds
        </label>
        <button id="refresh-overview-btn" class="btn btn-secondary btn-sm">Refresh</button>
      </div>
    </div>

    <!-- Health & Status Cards -->
    <div class="stats-row" id="overview-stats">
      <div class="stat-item">
        <div class="stat-label">Redis status</div>
        <div class="stat-value" id="stat-redis">Loading...</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">PostgreSQL status</div>
        <div class="stat-value" id="stat-pg">Loading...</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Degraded mode</div>
        <div class="stat-value" id="stat-degraded">Loading...</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">Global bypass</div>
        <div class="stat-value" id="stat-bypass">Loading...</div>
      </div>
    </div>

    <!-- Decisions Chart Section -->
    <div class="panel">
      <h2>Recent decision latency</h2>
      <p class="help-text" style="margin-bottom: 16px;">Latency in milliseconds across the latest decisions in the ring buffer</p>
      <div id="latency-chart-container" style="width: 100%; height: 160px; overflow: hidden;">
        <div class="state-loading">Loading chart...</div>
      </div>
    </div>

    <!-- Decisions Stream Table -->
    <div class="panel">
      <div class="panel-header">
        <h2>Latest decisions</h2>
        <span class="help-text" id="decision-count-label">Last 200 decisions buffer</span>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Route</th>
              <th>Reason</th>
              <th>Result</th>
              <th class="num">Latency ms</th>
            </tr>
          </thead>
          <tbody id="decisions-table-body">
            <tr>
              <td colspan="6" class="state-loading">Loading decisions...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  async function loadData(): Promise<void> {
    try {
      const [readyz, bypassRes, decisions] = await Promise.all([
        api.getReadyz(),
        api.getBypass(),
        api.getDecisions(),
      ]);

      // Update Health Stats
      const statRedis = container.querySelector('#stat-redis');
      const statPg = container.querySelector('#stat-pg');
      const statDegraded = container.querySelector('#stat-degraded');
      const statBypass = container.querySelector('#stat-bypass');

      if (statRedis) {
        const isOk = readyz.checks.redis === 'ok';
        statRedis.innerHTML = `<span class="badge ${isOk ? 'badge-allowed' : 'badge-denied'}">${isOk ? 'Connected' : 'Disconnected'}</span>`;
      }
      if (statPg) {
        const isOk = readyz.checks.postgres === 'ok';
        statPg.innerHTML = `<span class="badge ${isOk ? 'badge-allowed' : 'badge-denied'}">${isOk ? 'Connected' : 'Disconnected'}</span>`;
      }
      if (statDegraded) {
        statDegraded.innerHTML = `<span class="badge ${readyz.degraded ? 'badge-warning' : 'badge-neutral'}">${readyz.degraded ? 'Degraded' : 'Normal'}</span>`;
      }
      if (statBypass) {
        statBypass.innerHTML = `<span class="badge ${bypassRes.bypass ? 'badge-warning' : 'badge-neutral'}">${bypassRes.bypass ? 'Active' : 'Disabled'}</span>`;
      }

      // Render Table
      const tbody = container.querySelector('#decisions-table-body');
      if (tbody) {
        if (!decisions || decisions.length === 0) {
          tbody.innerHTML = `
            <tr>
              <td colspan="6" class="state-empty">No decisions recorded yet. Send requests from the playground to see live stream.</td>
            </tr>
          `;
        } else {
          tbody.innerHTML = decisions.map((d) => {
            const date = new Date(d.timestamp);
            const timeStr = date.toLocaleTimeString();
            const isoStr = date.toISOString();
            const clientDisplay = d.clientName ? `${escapeHtml(d.clientName)} (${d.clientId})` : 'Anonymous';
            const resultBadge = d.allowed
              ? `<span class="badge badge-allowed">Allowed</span>`
              : `<span class="badge badge-denied">Denied</span>`;

            return `
              <tr>
                <td title="${isoStr}">${timeStr}</td>
                <td>${clientDisplay}</td>
                <td><span class="code-val">${escapeHtml(d.route)}</span></td>
                <td><span class="code-val">${escapeHtml(d.reason)}</span></td>
                <td>${resultBadge}</td>
                <td class="num">${d.latencyMs.toFixed(2)}</td>
              </tr>
            `;
          }).join('');
        }
      }

      // Render Plain SVG Latency Chart
      renderChart(container.querySelector('#latency-chart-container'), decisions);
    } catch (err: unknown) {
      console.error('Error loading overview:', err);
    }
  }

  function renderChart(target: HTMLElement | null, decisions: DecisionItem[]): void {
    if (!target) return;
    if (!decisions || decisions.length === 0) {
      target.innerHTML = '<div class="state-empty">No decision data available to draw chart</div>';
      return;
    }

    const data = [...decisions].reverse().slice(-40); // show up to last 40 chronologically
    const maxLatency = Math.max(...data.map(d => d.latencyMs), 10);
    const width = 800;
    const height = 140;
    const padding = 30;

    const points = data.map((d, index) => {
      const x = padding + (index / (data.length - 1 || 1)) * (width - padding * 2);
      const y = height - padding - (d.latencyMs / maxLatency) * (height - padding * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: 100%; display: block;" role="img" aria-label="Decision latency chart">
        <!-- Axes -->
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#DDD9D2" stroke-width="1" />
        <line x1="${padding}" y1="${padding}" x2="${padding}" y2="${height - padding}" stroke="#DDD9D2" stroke-width="1" />
        
        <!-- Y Axis Labels -->
        <text x="${padding - 6}" y="${padding + 4}" fill="#5F5E58" font-size="11" text-anchor="end" font-family="'IBM Plex Mono', monospace">${maxLatency.toFixed(0)}ms</text>
        <text x="${padding - 6}" y="${height - padding}" fill="#5F5E58" font-size="11" text-anchor="end" font-family="'IBM Plex Mono', monospace">0ms</text>

        <!-- X Axis Labels -->
        <text x="${padding}" y="${height - padding + 18}" fill="#5F5E58" font-size="11" font-family="'IBM Plex Mono', monospace">Oldest</text>
        <text x="${width - padding}" y="${height - padding + 18}" fill="#5F5E58" font-size="11" text-anchor="end" font-family="'IBM Plex Mono', monospace">Newest</text>

        <!-- Data Polyline -->
        <polyline fill="none" stroke="#2F6B4F" stroke-width="1.5" points="${points}" />

        <!-- Data Dots -->
        ${data.map((d, index) => {
          const x = padding + (index / (data.length - 1 || 1)) * (width - padding * 2);
          const y = height - padding - (d.latencyMs / maxLatency) * (height - padding * 2);
          const color = d.allowed ? '#2F6B4F' : '#B3261E';
          return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" fill="${color}" />`;
        }).join('')}
      </svg>
    `;

    target.innerHTML = svg;
  }

  // Bind Buttons & Auto Refresh
  const refreshBtn = container.querySelector('#refresh-overview-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadData());
  }

  const autoToggle = container.querySelector('#auto-refresh-toggle') as HTMLInputElement;
  if (autoToggle) {
    autoToggle.addEventListener('change', () => {
      if (autoToggle.checked) {
        refreshTimer = setInterval(loadData, 3000);
      } else if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
    });
  }

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
