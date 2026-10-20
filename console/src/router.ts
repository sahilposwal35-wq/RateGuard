import { isAuthenticated } from './api.js';

export type PageId = 'signin' | 'overview' | 'plans' | 'clients' | 'playground' | 'usage' | 'shadow' | 'settings';

type PageHandler = (container: HTMLElement) => Promise<void> | void;

const routes = new Map<PageId, PageHandler>();
let currentPage: PageId = 'signin';

export function registerRoute(page: PageId, handler: PageHandler): void {
  routes.set(page, handler);
}

export function getCurrentPage(): PageId {
  return currentPage;
}

export async function navigateTo(page: PageId): Promise<void> {
  if (!isAuthenticated() && page !== 'signin') {
    page = 'signin';
  }

  window.location.hash = page;
  currentPage = page;

  // Update sidebar active link
  document.querySelectorAll('.nav-item').forEach((el) => {
    const navLink = el as HTMLElement;
    if (navLink.dataset.page === page) {
      navLink.classList.add('active');
    } else {
      navLink.classList.remove('active');
    }
  });

  // Render container
  const container = document.getElementById('view-content');
  if (!container) return;

  const handler = routes.get(page);
  if (handler) {
    container.innerHTML = '<div class="state-loading">Loading...</div>';
    try {
      await handler(container);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'An error occurred';
      container.innerHTML = `
        <div class="notice notice-error">
          <p>${msg}</p>
        </div>
      `;
    }
  } else {
    container.innerHTML = '<div class="notice notice-error">Page not found</div>';
  }
}

export function initRouter(): void {
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash.replace('#', '') as PageId;
    const target = routes.has(hash) ? hash : 'overview';
    navigateTo(target);
  });

  const initial = (window.location.hash.replace('#', '') as PageId) || 'overview';
  navigateTo(routes.has(initial) ? initial : 'overview');
}
