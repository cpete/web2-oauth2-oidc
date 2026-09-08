# Devcontainer build of the `client` sandbox. Mirrors client/Dockerfile and adds
# what the VS Code Server needs on top of the alpine (musl) base:
#   * libstdc++ - the server's bundled node binary links against it
#   * git       - source control in the integrated terminal
FROM alpine:3.20

RUN apk add --no-cache curl jq bash libstdc++ git

COPY client/client-credentials.sh /usr/local/bin/client-credentials
RUN chmod +x /usr/local/bin/client-credentials

# Keep the container alive so VS Code can attach and `docker compose exec` works.
CMD ["sleep", "infinity"]
