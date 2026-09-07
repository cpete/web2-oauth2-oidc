import { randomUUID } from "node:crypto";

import express from "express";
import { createRemoteJWKSet, jwtVerify } from "jose";

// --- configuration -----------------------------------------------------------

const PORT = Number(process.env.PORT ?? 3001);

// The issuer as it appears in the token's `iss` claim. Keycloak in dev mode
// derives this from the request, so tokens minted for the browser clients say
// `http://localhost:8080/...`.
const OIDC_ISSUER =
  process.env.OIDC_ISSUER ?? "http://localhost:8080/realms/workshop";

// Where this service fetches the signing keys. Inside the Compose network
// Keycloak is reachable as `keycloak`, not `localhost`.
const OIDC_JWKS_URI =
  process.env.OIDC_JWKS_URI ??
  "http://keycloak:8080/realms/workshop/protocol/openid-connect/certs";

// This resource server only accepts tokens whose audience targets it.
const API_AUDIENCE = process.env.API_AUDIENCE ?? "workshop-api";

const SCOPE_READ = "todo.read";
const SCOPE_WRITE = "todo.write";
const ADMIN_ROLE = "todo-admin";

const jwks = createRemoteJWKSet(new URL(OIDC_JWKS_URI));

// --- in-memory todo store --------------------------------------------------

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   done: boolean,
 *   owner: string,
 *   createdAt: string,
 *   updatedAt: string,
 * }} Todo
 */

/** @type {Map<string, Todo>} */
const todos = new Map();

function createTodo({ title, done = false, owner }) {
  const now = new Date().toISOString();
  /** @type {Todo} */
  const todo = {
    id: randomUUID(),
    title,
    done: Boolean(done),
    owner,
    createdAt: now,
    updatedAt: now,
  };
  todos.set(todo.id, todo);
  return todo;
}

// A few todos to make GET /todos interesting on a fresh start.
for (const title of [
  "Read RFC 6749 (The OAuth 2.0 Authorization Framework)",
  "Explain the difference between OAuth2 and OIDC",
  "Call this API with an access token that has the todo.read scope",
]) {
  createTodo({ title, owner: "workshop" });
}

// --- auth middleware ------------------------------------------------------------

function unauthorized(res, error, description) {
  const params = [`error="${error}"`];
  if (description) params.push(`error_description="${description}"`);
  return res
    .status(401)
    .set("WWW-Authenticate", `Bearer ${params.join(", ")}`)
    .json({ error, error_description: description });
}

async function authenticate(req, res, next) {
  const header = req.get("authorization") ?? "";
  const [scheme, token] = header.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return unauthorized(res, "invalid_request", "missing bearer token");
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: OIDC_ISSUER,
      audience: API_AUDIENCE,
    });

    req.auth = payload;
    req.subject = payload.preferred_username ?? payload.sub;
    req.scopes =
      typeof payload.scope === "string" ? payload.scope.split(" ") : [];
    req.isAdmin = Boolean(payload.realm_access?.roles?.includes(ADMIN_ROLE));
    next();
  } catch (err) {
    return unauthorized(res, "invalid_token", err.message);
  }
}

function requireScope(scope) {
  return (req, res, next) => {
    if (!req.scopes.includes(scope)) {
      return res
        .status(403)
        .set(
          "WWW-Authenticate",
          `Bearer error="insufficient_scope", scope="${scope}"`,
        )
        .json({ error: "insufficient_scope", required_scope: scope });
    }
    next();
  };
}

/** Non-admins may only touch their own todos. */
function canModify(req, todo) {
  return req.isAdmin || todo.owner === req.subject;
}

// --- app --------------------------------------------------------------------

const app = express();
app.use(express.json());

app.use((req, _res, next) => {
  console.log(`${req.method} ${req.originalUrl}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Everything below requires a valid access token.
app.use(authenticate);

app.get("/me", (req, res) => {
  res.json({
    subject: req.subject,
    scopes: req.scopes,
    isAdmin: req.isAdmin,
    issuer: req.auth.iss,
    audience: req.auth.aud,
  });
});

app.get("/todos", requireScope(SCOPE_READ), (req, res) => {
  const all = [...todos.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
  res.json(all);
});

app.get("/todos/:id", requireScope(SCOPE_READ), (req, res) => {
  const todo = todos.get(req.params.id);
  if (!todo) return res.status(404).json({ error: "not_found" });
  res.json(todo);
});

app.post("/todos", requireScope(SCOPE_WRITE), (req, res) => {
  const { title, done } = req.body ?? {};
  if (typeof title !== "string" || title.trim() === "") {
    return res
      .status(400)
      .json({ error: "invalid_body", detail: "title is required" });
  }
  const todo = createTodo({ title: title.trim(), done, owner: req.subject });
  res.status(201).location(`/todos/${todo.id}`).json(todo);
});

function updateTodo(req, res) {
  const todo = todos.get(req.params.id);
  if (!todo) return res.status(404).json({ error: "not_found" });
  if (!canModify(req, todo)) {
    return res
      .status(403)
      .json({ error: "forbidden", detail: "not your todo" });
  }

  const { title, done } = req.body ?? {};
  if (title !== undefined) {
    if (typeof title !== "string" || title.trim() === "") {
      return res
        .status(400)
        .json({ error: "invalid_body", detail: "title must be a non-empty string" });
    }
    todo.title = title.trim();
  }
  if (done !== undefined) {
    todo.done = Boolean(done);
  }
  todo.updatedAt = new Date().toISOString();
  todos.set(todo.id, todo);
  res.json(todo);
}

app.put("/todos/:id", requireScope(SCOPE_WRITE), updateTodo);
app.patch("/todos/:id", requireScope(SCOPE_WRITE), updateTodo);

app.delete("/todos/:id", requireScope(SCOPE_WRITE), (req, res) => {
  const todo = todos.get(req.params.id);
  if (!todo) return res.status(404).json({ error: "not_found" });
  if (!canModify(req, todo)) {
    return res
      .status(403)
      .json({ error: "forbidden", detail: "not your todo" });
  }
  todos.delete(todo.id);
  res.status(204).end();
});

app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid_json" });
  }
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

app.listen(PORT, () => {
  console.log(`todo resource server listening on :${PORT}`);
  console.log(`  issuer:   ${OIDC_ISSUER}`);
  console.log(`  jwks:     ${OIDC_JWKS_URI}`);
  console.log(`  audience: ${API_AUDIENCE}`);
});
