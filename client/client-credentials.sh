#!/usr/bin/env bash
#
# Walk through the OAuth2 client credentials grant end to end:
#
#   1. the client authenticates to Keycloak with its own id + secret
#   2. Keycloak returns an access token -- no user, no browser, no consent
#   3. the client calls the resource server with that token
#
# Everything is configurable via the environment (see compose.yaml). Extra
# arguments are passed straight through to the final curl, e.g.
#
#   client-credentials                       # GET /todos
#   client-credentials /me                   # GET /me
#   client-credentials -X POST /todos \
#     -H 'content-type: application/json' -d '{"title":"hi"}'
#
set -euo pipefail

TOKEN_URL="${TOKEN_URL:-http://keycloak:8080/realms/workshop/protocol/openid-connect/token}"
API_BASE="${API_BASE:-http://todo-api:3001}"
CLIENT_ID="${CLIENT_ID:-worker}"
CLIENT_SECRET="${CLIENT_SECRET:-dev-worker-secret-not-for-production}"
SCOPE="${SCOPE:-todo.read}"

# The resource server only trusts tokens whose `iss` is
# http://localhost:8080/realms/workshop -- that is the URL the browser clients
# use to reach Keycloak. From inside the Compose network we reach it as
# `keycloak:8080`, and Keycloak in dev mode stamps the issuer from the request's
# Host header, so we override that header to get a token the API will accept.
ISSUER_HOST="${ISSUER_HOST:-localhost:8080}"

REQUEST_PATH="/todos"
CURL_ARGS=()
for arg in "$@"; do
  case "$arg" in
    /*) REQUEST_PATH="$arg" ;;
    *)  CURL_ARGS+=("$arg") ;;
  esac
done

b64url_decode() {
  local data="${1//-/+}"
  data="${data//_/\/}"
  case $(( ${#data} % 4 )) in
    2) data="${data}==" ;;
    3) data="${data}=" ;;
  esac
  printf '%s' "$data" | base64 -d
}

echo "==> 1. asking Keycloak for a token"
echo "    POST $TOKEN_URL"
echo "    grant_type=client_credentials  client_id=$CLIENT_ID  scope=$SCOPE"
echo

token_response=$(curl -sS -H "Host: $ISSUER_HOST" "$TOKEN_URL" \
  -d grant_type=client_credentials \
  -d client_id="$CLIENT_ID" \
  -d client_secret="$CLIENT_SECRET" \
  -d scope="$SCOPE")

echo "$token_response" | jq '{token_type, expires_in, scope}'

access_token=$(echo "$token_response" | jq -r '.access_token // empty')
if [ -z "$access_token" ]; then
  echo
  echo "no access_token in response:" >&2
  echo "$token_response" | jq . >&2
  exit 1
fi

echo
echo "==> 2. the access token payload"
b64url_decode "$(echo "$access_token" | cut -d. -f2)" \
  | jq '{iss, aud, azp, scope, preferred_username, exp}'

echo
echo "==> 3. calling the resource server with the token"
echo "    GET ${API_BASE}${REQUEST_PATH}"
echo
curl -sS "${API_BASE}${REQUEST_PATH}" \
  -H "Authorization: Bearer $access_token" \
  "${CURL_ARGS[@]}" | jq .
