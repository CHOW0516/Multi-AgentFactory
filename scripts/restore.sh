#!/bin/sh
# Restores a backup made by the `backup` service into the running postgres container.
#   scripts/restore.sh                      -> lists the available dumps
#   scripts/restore.sh <file name> --yes    -> restores that dump (replaces ALL current data)
# The app services are stopped during the restore and started again afterwards.
set -eu
cd "$(dirname "$0")/.."

app_services="api orchestrator agent-order agent-material agent-planning agent-quality agent-monitoring agent-maintenance simulator"

if [ $# -eq 0 ]; then
    echo "Available backups (newest first):"
    ls -1t backups/factory-*.dump 2>/dev/null | xargs -r -n1 basename || true
    echo
    echo "Restore with: scripts/restore.sh <file name> --yes"
    exit 0
fi

file_name="$(basename "$1")"
if [ ! -f "backups/$file_name" ]; then
    echo "Not found: backups/$file_name" >&2
    exit 1
fi
if [ "${2:-}" != "--yes" ]; then
    echo "This replaces ALL data in the database with backups/$file_name."
    echo "Run again with --yes to continue."
    exit 1
fi

running_services="$(docker compose ps --services --status running)"
services_to_restart=""
for service in $app_services; do
    if echo "$running_services" | grep -qx "$service"; then
        services_to_restart="$services_to_restart $service"
    fi
done

if [ -n "$services_to_restart" ]; then
    echo "Stopping:$services_to_restart"
    # shellcheck disable=SC2086
    docker compose stop $services_to_restart
fi

echo "Restoring $file_name ..."
docker compose run --rm --no-deps -T --entrypoint sh backup -c \
    "pg_restore --clean --if-exists --no-owner --single-transaction --dbname=\"\$PGDATABASE\" /backups/$file_name"

documents_file="documents-${file_name#factory-}"
documents_file="${documents_file%.dump}.tar.gz"
if [ -f "backups/$documents_file" ]; then
    echo "Restoring PO files from $documents_file ..."
    docker compose run --rm --no-deps -T -v factory-commit_documents:/restore --entrypoint sh backup -c \
        "tar -xzf /backups/$documents_file -C /restore"
else
    echo "No PO file archive found for this dump ($documents_file); PO files were not restored."
fi

# Messages in the queue refer to the state before the restore; drop them so agents do not act on them.
if docker compose ps --services --status running | grep -qx rabbitmq; then
    echo "Purging message queues ..."
    for queue in $(docker compose exec -T rabbitmq rabbitmqctl -q list_queues name | grep -E '^(agent|orchestrator|monitoring)\.'); do
        docker compose exec -T rabbitmq rabbitmqctl -q purge_queue "$queue" >/dev/null
    done
fi

if [ -n "$services_to_restart" ]; then
    echo "Starting:$services_to_restart"
    # shellcheck disable=SC2086
    docker compose start $services_to_restart
fi
echo "Restore finished."
