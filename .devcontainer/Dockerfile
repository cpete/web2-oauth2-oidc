# The Keycloak runtime image is a ubi9-micro build: no package manager, and it
# ships almost none of what the VS Code Server needs to install and run:
#   * tar + gzip     - the server installer unpacks itself with `tar -xz`
#   * awk (gawk)     - used by the server's shell helper scripts, including
#                      bin/helpers/check-requirements.sh (which runs under
#                      `set -e`, so a missing command aborts it with exit 1)
#   * libstdc++.so.6 - the server's bundled node binary links against it
#
# There is no package manager in the final image to add these, so install them
# in a full UBI9 stage (same RHEL 9.x base, so the ABI matches) and copy each
# binary together with its shared-library closure into a staging root. Every
# path is normalised under /usr so the tree merges cleanly onto the final
# image, where /lib64 and /bin are symlinks into /usr.
ARG KEYCLOAK_VERSION=26.7.3

FROM registry.access.redhat.com/ubi9/ubi:9.8 AS tools
RUN dnf install -y --nodocs --setopt=install_weak_deps=0 tar gzip gawk libstdc++
RUN set -eu; \
    mkdir -p /staging/usr/bin /staging/usr/lib64; \
    stage() { \
        src=$1; dst=$2; \
        real=$(readlink -f "$src"); \
        cp -a "$real" "/staging${dst}$(basename "$real")"; \
        [ "$(basename "$src")" = "$(basename "$real")" ] || \
            ln -sf "$(basename "$real")" "/staging${dst}$(basename "$src")"; \
    }; \
    for b in /usr/bin/tar /usr/bin/gzip /usr/bin/gawk; do stage "$b" /usr/bin/; done; \
    ln -sf gawk /staging/usr/bin/awk; \
    stage /usr/lib64/libstdc++.so.6 /usr/lib64/; \
    for b in /usr/bin/tar /usr/bin/gzip /usr/bin/gawk; do \
        ldd "$b" | sed -n 's/.*=> \(\/[^ ]*\) (.*/\1/p'; \
    done | sort -u | grep -v 'ld-linux' | while read -r lib; do \
        stage "$lib" /usr/lib64/; \
    done

FROM quay.io/keycloak/keycloak:${KEYCLOAK_VERSION}
COPY --from=tools /staging/ /
USER root
RUN /sbin/ldconfig
USER 1000
