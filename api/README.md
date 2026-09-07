# Todo Resource Server

An Express API that manages an in-memory list of todos. It is an OAuth2
**resource server**: it does not log anyone in, it only validates the access
tokens that Keycloak issues to the workshop clients.

## Running

Started as part of the Compose stack:

```sh
docker compose up -d todo-api
```

Listens on `http://localhost:3001`.

## Token validation

Every request except `GET /health` must carry `Authorization: Bearer <access_token>`.
The token is checked for:

- signature against the realm JWKS (`OIDC_JWKS_URI`)
- `iss` equal to `OIDC_ISSUER`
- `aud` containing `API_AUDIENCE` (`workshop-api`)
- not expired

Configuration is via environment variables (see `compose.yaml`):

| Variable        | Default                                                                    |
| --------------- | ------------------------------------------------------------------------- |
| `PORT`          | `3001`                                                                   |
| `OIDC_ISSUER`   | `http://localhost:8080/realms/workshop`                                  |
| `OIDC_JWKS_URI` | `http://keycloak:8080/realms/workshop/protocol/openid-connect/certs`     |
| `API_AUDIENCE`  | `workshop-api`                                                          |

## Authorization

| Method + path      | Required scope | Notes                                              |
| ------------------ | -------------- | ------------------------------------------------- |
| `GET /health`      | –              | no token required                                 |
| `GET /me`          | –              | any valid token; echoes the caller's claims      |
| `GET /todos`       | `todo.read`    |                                                  |
| `GET /todos/:id`   | `todo.read`    |                                                  |
| `POST /todos`      | `todo.write`   | body: `{ "title": string, "done"?: boolean }`     |
| `PUT /todos/:id`   | `todo.write`   | owner or `todo-admin` role                        |
| `PATCH /todos/:id` | `todo.write`   | owner or `todo-admin` role                        |
| `DELETE /todos/:id`| `todo.write`   | owner or `todo-admin` role                        |

A todo's `owner` is the caller's `preferred_username`. Users with the realm
role `todo-admin` may modify and delete any todo.

## Quick check

```sh
# get a token for the batch worker (client credentials)
TOKEN=$(curl -s http://localhost:8080/realms/workshop/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=worker \
  -d client_secret=dev-worker-secret-not-for-production \
  -d scope=todo.read | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')

curl -s http://localhost:3001/todos -H "Authorization: Bearer $TOKEN"
```

Note: `worker` only has `todo.read` as an optional scope, so writes from the
worker return `403 insufficient_scope`. Use the `webapp` or `spa` client (which
have both `todo.read` and `todo.write` as optional scopes) to exercise writing.
