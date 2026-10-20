import { setAdminToken, api } from '../api.js';
import { navigateTo } from '../router.js';

export function renderSignIn(container: HTMLElement): void {
  container.innerHTML = `
    <div style="max-width: 400px; margin: 40px auto;">
      <div class="panel">
        <h1>Sign in</h1>
        <p class="description">Enter the admin token to access the control console</p>

        <form id="signin-form">
          <div class="form-group">
            <label for="admin-token">Admin token</label>
            <input
              type="password"
              id="admin-token"
              class="input-text input-mono"
              placeholder="Paste admin token"
              required
              autocomplete="current-password"
            />
            <div id="signin-error" class="input-error-msg" style="display: none;"></div>
            <p class="help-text">The token is held in memory for this browser session only</p>
          </div>

          <div style="margin-top: 24px;">
            <button type="submit" id="signin-submit-btn" class="btn btn-primary" style="width: 100%;">
              Continue to console
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const form = container.querySelector('#signin-form') as HTMLFormElement;
  const input = container.querySelector('#admin-token') as HTMLInputElement;
  const errorEl = container.querySelector('#signin-error') as HTMLElement;
  const submitBtn = container.querySelector('#signin-submit-btn') as HTMLButtonElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying...';

    const token = input.value.trim();
    setAdminToken(token);

    try {
      // Validate token against bypass read endpoint
      await api.getBypass();
      navigateTo('overview');
    } catch (err: unknown) {
      errorEl.textContent = 'Invalid admin token. Check your token and try again.';
      errorEl.style.display = 'block';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue to console';
    }
  });

  input.focus();
}
