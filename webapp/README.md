# Web App (Confidential Client)

A server-side **TypeScript / Express** application. It is an OAuth2 / OIDC
**confidential client**: it runs the Authorization Code Flow (with PKCE) against
Keycloak, keeps the tokens in a **server-side session**, and hands the browser
nothing but a signed session cookie.

The browser never sees an access or refresh token. The app uses the session's
access token to call the [todo resource server](../api/README.md) on the user's
behalf.

## Running

Started as part of the Compose stack:

```sh
docker compose up -d webapp
```

Then open `http://localhost:3000` and log in (`student` / `student` or
`manager` / `manager`).

## The flow

1. `GET /login` – the app creates a PKCE `code_verifier`, a `state` and a
   `nonce`, stores them in the session, and redirects the browser to Keycloak's
   `authorization_endpoint` with `response_type=code` and the `code_challenge`.
2. Keycloak authenticates the user and redirects back to
   `GET /callback?code=...&state=...`.
3. The app exchanges the `code` at the `token_endpoint`, authenticating itself
   with `client_id` + `client_secret` (HTTP Basic). It verifies `state`, the ID
   token signature, `iss`, `aud` and `nonce`.
4. The token set (access / refresh / ID token) is stored in the session. The
   session id is regenerated. The browser gets the `webapp.sid` cookie
   (`HttpOnly`, `SameSite=Lax`).
5. On later requests the app reads the access token from the session, refreshing
   it via the refresh token when it has expired, and calls the todo API.
6. `GET /logout` destroys the local session and redirects to Keycloak's
   `end_session_endpoint` (RP-initiated logout).

## Routes

| Route                     | Purpose                                              |
| ------------------------- | --------------------------------------------------- |
| `GET /`                   | login state; shows the ID token claims and decoded access token |
| `GET /login`              | start the Authorization Code Flow                    |
| `GET /callback`           | redirect target; exchanges the code for tokens      |
| `GET /logout`             | RP-initiated logout                                  |
| `GET /me`                 | proxies the API's `GET /me` with the session token  |
| `GET /todos`              | lists todos from the API; form to add one           |
| `POST /todos`             | creates a todo (needs `todo.write`)                 |
| `POST /todos/:id/toggle`  | flips a todo's `done` flag                          |
| `GET /healthz`            | liveness, no auth                                    |

## Configuration

Environment variables (see `compose.yaml`):

| Variable             | Default                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| `PORT`               | `3000`                                                                         |
| `APP_BASE_URL`       | `http://localhost:3000`                                                        |
| `OIDC_DISCOVERY_URL` | `http://keycloak:8080/realms/workshop/.well-known/openid-configuration`        |
| `OIDC_CLIENT_ID`     | `webapp`                                                                       |
| `OIDC_CLIENT_SECRET` | `dev-secret-not-for-production`                                                |
| `OIDC_REDIRECT_URI`  | `http://localhost:3000/callback`                                              |
| `OIDC_SCOPE`         | `openid profile email todo.read todo.write`                                   |
| `API_BASE_URL`       | `http://todo-api:3001`                                                        |
| `SESSION_SECRET`     | `dev-session-secret-not-for-production`                                        |

### Keycloak split-horizon

The app reaches Keycloak as `http://keycloak:8080` on the Compose network, but
the browser reaches it as `http://localhost:8080`. The `keycloak` service is
configured with

```
KC_HOSTNAME: http://localhost:8080
KC_HOSTNAME_BACKCHANNEL_DYNAMIC: "true"
```

so the discovered `issuer`, `authorization_endpoint` and `end_session_endpoint`
are always the public `localhost:8080` URLs (used by the browser), while the
`token_endpoint` and `jwks_uri` resolve to whatever host the request came in on
(`keycloak:8080` for this app). The token `iss` is therefore stable at
`http://localhost:8080/realms/workshop`, which is what the resource server
expects.

## Development

```sh
cd webapp
npm install
OIDC_DISCOVERY_URL=http://localhost:8080/realms/workshop/.well-known/openid-configuration \
API_BASE_URL=http://localhost:3001 \
npm run dev
```

(Pointing `OIDC_DISCOVERY_URL` and `API_BASE_URL` at `localhost` when running
outside Compose.)

The session store is the default in-memory store: fine for the workshop, not for
production.
