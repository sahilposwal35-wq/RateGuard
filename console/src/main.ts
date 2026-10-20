import { initRouter, registerRoute, navigateTo, getCurrentPage } from './router.js';
import { isAuthenticated, clearAdminToken } from './api.js';
import { renderSignIn } from './pages/signin.js';
import { renderOverview } from './pages/overview.js';
import { renderPlans } from './pages/plans.js';
import { renderClients } from './pages/clients.js';
import { renderPlayground } from './pages/playground.js';
import { renderUsage } from './pages/usage.js';
import { renderShadow } from './pages/shadow.js';
import { renderSettings } from './pages/settings.js';

function setupAppShell(): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="app-layout">
      <!-- Left Sidebar Navigation -->
      <aside class="sidebar" id="app-sidebar" style="display: none;">
        <div class="sidebar-header sidebar-brand">
          <div class="brand-title">RateGuard</div>
          <div class="brand-subtitle">Admin console</div>
        </div>

        <nav class="sidebar-nav">
          <a href="#overview" class="nav-item" data-page="overview">Overview</a>
          <a href="#plans" class="nav-item" data-page="plans">Plans and policies</a>
          <a href="#clients" class="nav-item" data-page="clients">Clients and API keys</a>
          <a href="#playground" class="nav-item" data-page="playground">Test playground</a>
          <a href="#usage" class="nav-item" data-page="usage">Quota and usage</a>
          <a href="#shadow" class="nav-item" data-page="shadow">Shadow mode report</a>
          <a href="#settings" class="nav-item" data-page="settings">Settings</a>
        </nav>

        <div class="sidebar-footer">
          <button id="btn-signout" class="btn btn-secondary btn-sm" style="width: 100%;">Sign out</button>
        </div>
      </aside>

      <!-- Main Content Area -->
      <main class="main-content main-container">
        <div id="view-content"></div>
      </main>
    </div>
  `;

  const sidebar = document.getElementById('app-sidebar') as HTMLElement;
  const signoutBtn = document.getElementById('btn-signout') as HTMLButtonElement;

  function updateSidebarVisibility(): void {
    const authed = isAuthenticated();
    if (authed) {
      sidebar.style.display = 'flex';
    } else {
      sidebar.style.display = 'none';
    }
  }

  // Hook into router to update sidebar on route change
  window.addEventListener('hashchange', () => {
    updateSidebarVisibility();
  });

  signoutBtn.addEventListener('click', () => {
    clearAdminToken();
    updateSidebarVisibility();
    navigateTo('signin');
  });

  // Attach nav link click handlers
  document.querySelectorAll('.nav-item').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = (link as HTMLElement).dataset.page as any;
      if (page) {
        navigateTo(page);
      }
    });
  });

  updateSidebarVisibility();
}

function init(): void {
  setupAppShell();

  // Register all routes
  registerRoute('signin', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'none';
    renderSignIn(container);
  });

  registerRoute('overview', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderOverview(container);
  });

  registerRoute('plans', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderPlans(container);
  });

  registerRoute('clients', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderClients(container);
  });

  registerRoute('playground', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderPlayground(container);
  });

  registerRoute('usage', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderUsage(container);
  });

  registerRoute('shadow', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderShadow(container);
  });

  registerRoute('settings', (container) => {
    const sidebar = document.getElementById('app-sidebar');
    if (sidebar) sidebar.style.display = 'flex';
    return renderSettings(container);
  });

  initRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
