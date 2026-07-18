# redplanethq/cliproxy — thin wrapper around eceasy/cli-proxy-api that lets you
# seed OAuth tokens via env vars, so the container can boot straight into a
# pre-authenticated state on Railway / Fly / any host without an interactive
# --*-login step.
#
# The entrypoint decodes CLIPROXY_AUTH_<name>_B64 env vars into
# /root/.cli-proxy-api/<name>.json, then execs the upstream binary. See
# entrypoint.sh for the full contract.

FROM eceasy/cli-proxy-api:latest

COPY config.yaml /CLIProxyAPI/config.yaml
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
