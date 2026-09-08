import express, {
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import session from "express-session";
import {
  Issuer,
  generators,
  TokenSet,
  type IdTokenClaims,
  type TokenSetParameters,
} from "openid-client";

// --- configuration -----------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3000);

// The public base URL of this app, as the browser sees it. Used to build the
// redirect and post-logout URLs.
const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:3000";

// OIDC discovery document. This app talks to Keycloak server-to-server, so
// inside the Compose network it uses `keycloak:8080`, not `localhost:8080`.
// Keycloak is configured with a fixed frontend hostname, so the discovered
// `issuer` / `authorization_endpoint` / `end_session_endpoint` still point at
// `http://localhost:8080` for the browser, while token and JWKS calls resolve
// back to `http://keycloak:8080` (KC_HOSTNAME_BACKCHANNEL_DYNAMIC).
const OIDC_DISCOVERY_URL =
  process.env.OIDC_DISCOVERY_URL ??
  "http://keycloak:8080/realms/workshop/.well-known/openid-configuration";

const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? "webapp";

// A confidential client authenticates to the token endpoint with this secret.
const OIDC_CLIENT_SECRET =
  process.env.OIDC_CLIENT_SECRET ?? "dev-secret-not-for-production";

const OIDC_REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI ?? `${APP_BASE_URL}/callback`;

// `openid` for OIDC, `profile email` for the ID token claims, and the two
// resource-server scopes so the access token may call the todo API.
const OIDC_SCOPE =
  process.env.OIDC_SCOPE ?? "openid profile email todo.read todo.write";

// The todo resource server, reachable inside the Compose network.
const API_BASE_URL = process.env.API_BASE_URL ?? "http://todo-api:3001";

// Signs the session cookie. In production this must be a real secret.
const SESSION_SECRET =
  process.env.SESSION_SECRET ?? "dev-session-secret-not-for-production";

// --- session typing --------------------------------------------------------

declare module "express-session" {
  interface SessionData {
    // Set only while an Authorization Code Flow is in progress.
    flow?: { code_verifier: string; state: string; nonce: string };
    // Set once the user is logged in. The tokens never leave the server.
    tokens?: TokenSetParameters;
    claims?: IdTokenClaims;
  }
}

// --- OIDC client setup -----------------------------------------------------

/**
 * Keycloak may not be ready the instant this container starts, so retry the
 * discovery call for a while before giving up.
 */
async function discoverWithRetry(url: string, attempts = 40): Promise<Issuer> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await Issuer.discover(url);
    } catch (err) {
      if (attempt >= attempts) throw err;
      console.log(
        `OIDC discovery failed (attempt ${attempt}/${attempts}), retrying in 2s: ${
          (err as Error).message
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const issuer = await discoverWithRetry(OIDC_DISCOVERY_URL);
console.log(`discovered issuer: ${issuer.metadata.issuer}`);

const client = new issuer.Client({
  client_id: OIDC_CLIENT_ID,
  client_secret: OIDC_CLIENT_SECRET,
  redirect_uris: [OIDC_REDIRECT_URI],
  response_types: ["code"],
  // HTTP Basic against the token endpoint. Keycloak's default for a
  // confidential client.
  token_endpoint_auth_method: "client_secret_basic",
});

// --- helpers -------------------------------------------------------------------

/** Base64url-decode a JWT payload for display. No signature check here. */
function decodeJwtPayload(jwt: string | undefined): unknown {
  if (!jwt) return null;
  const part = jwt.split(".")[1];
  if (!part) return null;
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function isLoggedIn(req: Request): boolean {
  return Boolean(req.session.tokens);
}

function requireAuth(
  req: Request,
  res: ExpressResponse,
  next: NextFunction,
): void {
  if (!isLoggedIn(req)) {
    res.redirect("/login");
    return;
  }
  next();
}

/**
 * Return a valid access token for the session, refreshing it with the refresh
 * token if it has expired. The refreshed token set is written back to the
 * session.
 */
async function freshAccessToken(req: Request): Promise<string> {
  if (!req.session.tokens) throw new Error("not authenticated");

  let tokenSet = new TokenSet(req.session.tokens);

  if (tokenSet.expired() && tokenSet.refresh_token) {
    console.log("access token expired, refreshing");
    tokenSet = await client.refresh(tokenSet.refresh_token);
    req.session.tokens = { ...tokenSet };
    if (tokenSet.id_token) req.session.claims = tokenSet.claims();
  }

  if (!tokenSet.access_token) throw new Error("no access token in session");
  return tokenSet.access_token;
}

/** Call the todo resource server with the session's access token. */
async function callApi(
  req: Request,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const accessToken = await freshAccessToken(req);
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...((init.headers as Record<string, string> | undefined) ?? {}),
      authorization: `Bearer ${accessToken}`,
    },
  });
}

// --- tiny HTML view layer ----------------------------------------------------

function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch] as string,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  nav a { margin-right: 1rem; }
  pre { background: #f4f4f4; padding: 1rem; overflow-x: auto; border-radius: 6px; }
  ul { padding-left: 1.2rem; }
  form.inline { display: inline; }
  button { cursor: pointer; }
  .done { text-decoration: line-through; color: #777; }
</style>
</head>
<body>
<nav>
  <a href="/">Home</a>
  <a href="/todos">Todos</a>
  <a href="/me">API /me</a>
</nav>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}

// --- app --------------------------------------------------------------------

const app = express();
app.use(express.urlencoded({ extended: false }));

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

app.use(
  session({
    name: "webapp.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      // The callback is a top-level GET navigation coming back from Keycloak,
      // so "lax" is enough and keeps the cookie away from cross-site requests.
      sameSite: "lax",
      // Dev is plain HTTP. Set to true behind HTTPS.
      secure: false,
      maxAge: 1000 * 60 * 60,
    },
    // Default in-memory store: fine for a workshop, not for production.
  }),
);

// Health check, no auth.
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

// Home: show login state.
app.get("/", (req, res) => {
  if (!isLoggedIn(req)) {
    res.send(
      page(
        "Workshop Web App",
        `<p>You are not logged in.</p>
         <p><a href="/login">Log in with Keycloak</a></p>`,
      ),
    );
    return;
  }

  const claims = req.session.claims;
  res.send(
    page(
      "Workshop Web App",
      `<p>Logged in as <strong>${escapeHtml(
        claims?.preferred_username ?? "unknown",
      )}</strong>.</p>
       <p>
         <a href="/todos">Show todos</a> &middot;
         <a href="/logout">Log out</a>
       </p>
       <h2>ID token claims</h2>
       <pre>${escapeHtml(JSON.stringify(claims, null, 2))}</pre>
       <h2>Access token payload</h2>
       <pre>${escapeHtml(
         JSON.stringify(
           decodeJwtPayload(new TokenSet(req.session.tokens).access_token),
           null,
           2,
         ),
       )}</pre>`,
    ),
  );
});

// Step 1 of the Authorization Code Flow: build the authorization request.
app.get("/login", (req, res) => {
  const code_verifier = generators.codeVerifier();
  const state = generators.state();
  const nonce = generators.nonce();

  req.session.flow = { code_verifier, state, nonce };

  const authorizationUrl = client.authorizationUrl({
    scope: OIDC_SCOPE,
    code_challenge: generators.codeChallenge(code_verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });

  console.log('Redirecting to Keycloak for login:', authorizationUrl);

  res.redirect(authorizationUrl);
});

// Step 2: Keycloak redirects back here with `code` and `state`.
app.get("/callback", async (req, res, next) => {
  try {
    const flow = req.session.flow;
    if (!flow) {
      res.status(400).send(page("Login error", "<p>No login in progress.</p>"));
      return;
    }

    // params contains the query parameters from the callback URL, including `code` and `state`.
    const params = client.callbackParams(req);
    // here we exchange the authorization code for tokens, verifying the state, nonce, and code_verifier.
    const tokenSet = await client.callback(OIDC_REDIRECT_URI, params, {
      code_verifier: flow.code_verifier,
      state: flow.state,
      nonce: flow.nonce,
    });

    // New privilege level -> new session id (drops the in-progress `flow` too).
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.tokens = { ...tokenSet };
      req.session.claims = tokenSet.claims();
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        // we redirect to the home page after successful login. This could also be the originally requested page if we stored it before redirecting to login.
        res.redirect("/");
      });
    });
  } catch (err) {
    next(err);
  }
});

// End the local session and the Keycloak SSO session.
app.get("/logout", (req, res, next) => {
  const idToken = req.session.tokens?.id_token;
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("webapp.sid");
    const endSessionUrl = client.endSessionUrl({
      id_token_hint: idToken,
      post_logout_redirect_uri: `${APP_BASE_URL}/`,
    });
    res.redirect(endSessionUrl);
  });
});

// Proxy the resource server's GET /me using the session's access token.
app.get("/me", requireAuth, async (req, res, next) => {
  try {
    const apiRes = await callApi(req, "/me");
    const body = await apiRes.json();
    res.send(
      page(
        "API /me",
        `<p>Response from <code>${escapeHtml(API_BASE_URL)}/me</code> (status ${
          apiRes.status
        }):</p>
         <pre>${escapeHtml(JSON.stringify(body, null, 2))}</pre>`,
      ),
    );
  } catch (err) {
    next(err);
  }
});

// List todos and offer a create form.
app.get("/todos", requireAuth, async (req, res, next) => {
  try {
    const apiRes = await callApi(req, "/todos");
    if (!apiRes.ok) {
      const body = await apiRes.text();
      res
        .status(502)
        .send(
          page(
            "Todos",
            `<p>API returned ${apiRes.status}.</p><pre>${escapeHtml(body)}</pre>`,
          ),
        );
      return;
    }

    const todos = (await apiRes.json()) as Array<{
      id: string;
      title: string;
      done: boolean;
      owner: string;
    }>;

    const items = todos
      .map(
        (todo) => `<li>
          <form class="inline" method="post" action="/todos/${escapeHtml(
            todo.id,
          )}/toggle">
            <button type="submit">${todo.done ? "↺" : "✓"}</button>
          </form>
          <span class="${todo.done ? "done" : ""}">${escapeHtml(todo.title)}</span>
          <small>(${escapeHtml(todo.owner)})</small>
        </li>`,
      )
      .join("\n");

    res.send(
      page(
        "Todos",
        `<ul>${items || "<li><em>none</em></li>"}</ul>
         <h2>Add a todo</h2>
         <form method="post" action="/todos">
           <input name="title" placeholder="What needs doing?" required>
           <button type="submit">Add</button>
         </form>`,
      ),
    );
  } catch (err) {
    next(err);
  }
});

app.post("/todos", requireAuth, async (req, res, next) => {
  try {
    const title = String(req.body.title ?? "").trim();
    if (!title) {
      res.redirect("/todos");
      return;
    }
    const apiRes = await callApi(req, "/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!apiRes.ok) {
      const body = await apiRes.text();
      res
        .status(502)
        .send(
          page(
            "Todos",
            `<p>Create failed (${apiRes.status}).</p><pre>${escapeHtml(
              body,
            )}</pre>`,
          ),
        );
      return;
    }
    res.redirect("/todos");
  } catch (err) {
    next(err);
  }
});

app.post("/todos/:id/toggle", requireAuth, async (req, res, next) => {
  try {
    const getRes = await callApi(req, `/todos/${req.params.id}`);
    if (!getRes.ok) {
      res.redirect("/todos");
      return;
    }
    const todo = (await getRes.json()) as { done: boolean };
    await callApi(req, `/todos/${req.params.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ done: !todo.done }),
    });
    res.redirect("/todos");
  } catch (err) {
    next(err);
  }
});

// Express recognises this as an error handler by its four parameters.
app.use(
  (err: unknown, _req: Request, res: ExpressResponse, _next: NextFunction) => {
    console.error(err);
    res
      .status(500)
      .send(
        page(
          "Error",
          `<pre>${escapeHtml((err as Error)?.message ?? String(err))}</pre>`,
        ),
      );
  },
);

app.listen(PORT, () => {
  console.log(`webapp listening on :${PORT}`);
  console.log(`  base url:  ${APP_BASE_URL}`);
  console.log(`  client id: ${OIDC_CLIENT_ID}`);
  console.log(`  redirect:  ${OIDC_REDIRECT_URI}`);
  console.log(`  api:       ${API_BASE_URL}`);
});
