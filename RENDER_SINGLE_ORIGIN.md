# Serve the frontend and API from one Render origin

Safari can block third-party cookies even when the API sets `SameSite=None; Secure`.
For the browser session cookie to remain available, the frontend and API need to be
same-site. This setup serves both from the existing Render web service and keeps the
current httpOnly session cookie.

## Update the existing Render service

After merging the code change:

1. Open the existing AZO-HR web service in Render. Keep the service and its existing
   environment variables; do not create a replacement service.
2. In **Settings → Build & Deploy**, clear **Root Directory** so commands run from the
   repository root. The frontend build must be available to the backend at runtime.
3. Set the **Build Command** to:

   ```sh
   corepack enable && cd frontend && yarn install --non-interactive --no-progress && yarn build && cd ../backend && python -m pip install --disable-pip-version-check -r requirements.txt
   ```

4. Set the **Start Command** to:

   ```sh
   cd backend && uvicorn server:app --host 0.0.0.0 --port $PORT
   ```

5. Save the service settings and let Render deploy. Keep the existing MongoDB, manager,
   timezone, push-notification, and other environment variables unchanged.

The application will then be available at the existing Render service URL. Its `/api`
routes remain unchanged, while the root and client-side routes serve the React app. The
GitHub Pages build checks that this app is available before redirecting there; if Render
is not ready yet, Pages continues to show its existing app instead.

## Verify in Safari

1. Open the existing GitHub Pages URL. Once Render serves the frontend, it should
   redirect to the Render service URL while preserving the route, query, and hash.
2. Sign in and confirm the app remains open after loading the dashboard.
3. Reload the page. The session should remain authenticated.

Do not change the session token to local storage as a workaround; the existing
httpOnly-cookie design is safer for this HR application.
