#!/bin/sh
set -e

# Default command if none provided
if [ $# -eq 0 ]; then
    set -- nginx -g "daemon off;"
fi

# If command is not nginx (e.g. sh, echo, etc.), just exec it directly
if [ "$1" != "nginx" ]; then
    exec "$@"
fi

echo "=== Initializing Site Entrypoint ==="
# 1. Run official entrypoint configuration
/docker-entrypoint.sh nginx -v >/dev/null

# 2. Setup pre-emission FIFO
rm -f /var/log/nginx/error.log
mkfifo /var/log/nginx/error.log
chmod 666 /var/log/nginx/error.log

# 3. Start pre-emission companion filter
(
    exec 3< /var/log/nginx/error.log
    while IFS= read -r line <&3 || [ -n "$line" ]; do
        sanitized=$(printf '%s\n' "$line" | sed -E \
            -e 's@(/api/v1/citylife/(ws|browser-ws|auth/cookie|auth/clear))(\?|%3[fF]|/)[^[:space:]"]*@\1?[REDACTED]@g' \
            -e 's@(/kooker/api/v1/citylife/(ws|browser-ws|auth/cookie|auth/clear))(\?|%3[fF]|/)[^[:space:]"]*@\1?[REDACTED]@g' \
            -e 's@([?&](token|jwt|auth)=)[^&[:space:]"]*@\1[REDACTED]@g' \
            -e 's@(referrer:[[:space:]]*"https?://[^[:space:]"]*(\?|%3[fF]))[^[:space:]"]*@\1[REDACTED]@g' \
            -e 's@(Referer:[[:space:]]*https?://[^[:space:]"]*(\?|%3[fF]))[^[:space:]"]*@\1[REDACTED]@g')
        printf '%s\n' "$sanitized" >&2
    done
    exec 3<&-
) &
COMPANION_PID=$!
echo "PRE_EMISSION_COMPANION_PID=$COMPANION_PID"

# 4. Start Nginx
"$@" &
NGINX_PID=$!
echo "NGINX_MASTER_PID=$NGINX_PID"

forward_signal() {
    sig=$1
    if kill -0 "$NGINX_PID" 2>/dev/null; then
        kill -"$sig" "$NGINX_PID" 2>/dev/null || true
    fi
}

trap 'forward_signal QUIT' QUIT
trap 'forward_signal TERM' TERM
trap 'forward_signal INT' INT
trap 'forward_signal HUP' HUP

# 5. Supervision loop
while kill -0 "$NGINX_PID" 2>/dev/null && kill -0 "$COMPANION_PID" 2>/dev/null; do
    sleep 0.2 &
    wait $! 2>/dev/null || true
done

# If companion died unexpectedly while Nginx was running -> FAIL CLOSED
if ! kill -0 "$COMPANION_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; then
    echo "Pre-emission companion died unexpectedly; terminating Nginx (fail-closed)" >&2
    kill -TERM "$NGINX_PID" 2>/dev/null || true
    wait "$NGINX_PID" 2>/dev/null || true
    exit 1
fi

# Wait for Nginx exit code and await companion drain
NGINX_EXIT=0
wait "$NGINX_PID" 2>/dev/null || NGINX_EXIT=$?
if kill -0 "$COMPANION_PID" 2>/dev/null; then
    # Unblock reader if Nginx exited without ever opening the FIFO
    : > /var/log/nginx/error.log 2>/dev/null || true
fi
wait "$COMPANION_PID" 2>/dev/null || true
exit "$NGINX_EXIT"
