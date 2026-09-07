# web2-oauth2-oidc

## Local Keycloak

In VS Code, run **Dev Containers: Reopen in Container**. The Dev Container
configuration starts the `keycloak` Compose service and stops it when the VS
Code window closes.

Alternatively, start the authorization server from a terminal:

```sh
docker compose up -d
```

Open `http://localhost:8080` and sign in to the administration console with
username `admin` and password `admin`.

Stop the service with `docker compose down`. Its data remains in the
`keycloak-data` Docker volume; remove it with `docker compose down -v` when a
fresh instance is needed.