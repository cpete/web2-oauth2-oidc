# Client Credentials Sandbox

A tiny container (`alpine` + `curl` + `jq`) on the Compose network for trying
out the OAuth2 **client credentials** grant against the workshop Keycloak and
the `todo-api` resource server.

The `worker` client in the realm is configured for this grant
(`serviceAccountsEnabled`, no browser, no user). Its dev secret is
`dev-worker-secret-not-for-production`.

## Running

```sh
docker compose up -d client
```

The container just sleeps. Use it two ways:

### Guided walkthrough

```sh
docker compose exec client client-credentials
```

This prints each step: the token request, the decoded token payload, and the
`GET /todos` call made with that token.

Pass a different path and/or extra curl flags:

```sh
docker compose exec client client-credentials /me
docker compose exec client client-credentials -X POST /todos \
  -H 'content-type: application/json' -d '{"title":"from the worker"}'
```

`POST /todos` returns `403 insufficient_scope`: `worker` only has `todo.read`
as an optional scope. Set `SCOPE` in `compose.yaml` to `todo.read todo.write`
and it still fails — the client is not granted `todo.write` at all. That is the
point of the exercise.

### Raw curl

```sh
docker compose exec client bash

TOKEN=$(curl -s -H 'Host: localhost:8080' \
  http://keycloak:8080/realms/workshop/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=worker \
  -d client_secret=dev-worker-secret-not-for-production \
  -d scope=todo.read | jq -r .access_token)

curl -s http://todo-api:3001/todos -H "Authorization: Bearer $TOKEN" | jq .
```

## Why the `Host: localhost:8080` header

`todo-api` only accepts tokens whose `iss` is
`http://localhost:8080/realms/workshop` (the URL the browser clients use).
Inside the Compose network Keycloak is `keycloak:8080`, and in dev mode it
derives the issuer from the request's `Host` header, so the header override
produces a token the API will accept. From the host machine you would just call
`http://localhost:8080` directly and not need this.
