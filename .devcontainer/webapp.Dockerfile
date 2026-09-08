# Dev image for the `webapp` devcontainer. The production webapp/Dockerfile
# strips itself down to a runtime (`npm install --omit=dev`, `USER node`); this
# one keeps the full toolchain and adds what the alpine base omits:
#   * libstdc++ - the VS Code Server's bundled node binary links against it
#   * git, bash - source control + a real shell for the integrated terminal
# devDependencies (tsx, typescript) come from `npm install` in the mounted
# workspace, run by the devcontainer's postCreateCommand.
FROM node:22-alpine
RUN apk add --no-cache libstdc++ git bash
