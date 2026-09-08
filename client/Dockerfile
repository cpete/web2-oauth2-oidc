# A throwaway box with curl + jq, sitting on the Compose network, for
# exercising the OAuth2 client credentials grant by hand.
FROM alpine:3.20

RUN apk add --no-cache curl jq bash

COPY client-credentials.sh /usr/local/bin/client-credentials
RUN chmod +x /usr/local/bin/client-credentials

# Keep the container alive so `docker compose exec client ...` works.
CMD ["sleep", "infinity"]
