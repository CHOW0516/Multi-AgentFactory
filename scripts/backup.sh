#!/bin/sh
# Runs inside the `backup` compose service (postgres:16-alpine).
#   backup.sh schedule  -> installs BACKUP_CRON for busybox crond and runs it in the foreground
#   backup.sh once      -> takes one pg_dump now
# Dumps go to BACKUP_PATH as factory-YYYYMMDD-HHMMSS.dump (custom format, for pg_restore),
# with the PO files as documents-YYYYMMDD-HHMMSS.tar.gz. Copy BACKUP_PATH to another disk or the cloud:
# a backup on the same disk as the database is lost with it.
# Only the newest BACKUP_KEEP dumps are kept (default 72 = three days of hourly dumps).
set -eu

backup_path="${BACKUP_PATH:-/backups}"
keep_count="${BACKUP_KEEP:-72}"
documents_path="${DOCUMENTS_PATH:-/data/documents}"

take_backup() {
    mkdir -p "$backup_path"
    stamp="$(date -u +%Y%m%d-%H%M%S)"
    file_name="$backup_path/factory-$stamp.dump"
    documents_file="$backup_path/documents-$stamp.tar.gz"
    rm -f "$backup_path"/*.partial
    # Write to a temp name first so a half-written dump never looks like a good one.
    # "|| fail" because `set -e` does not stop on a failed command inside an && list.
    pg_dump --format=custom --file="$file_name.partial" || fail "pg_dump failed"
    mv "$file_name.partial" "$file_name"
    # The original PO files are the legal record of each order; they live outside the database.
    if [ -d "$documents_path" ]; then
        tar -czf "$documents_file.partial" -C "$documents_path" . || fail "documents archive failed"
        mv "$documents_file.partial" "$documents_file"
    fi
    echo "$(date -u +%FT%TZ) backup written: $file_name"
    # Remove the oldest backups beyond the keep count.
    for pattern in "factory-*.dump" "documents-*.tar.gz"; do
        ls -1 "$backup_path"/$pattern 2>/dev/null | sort -r | tail -n +"$((keep_count + 1))" | xargs -r rm -f
    done
}

fail() {
    echo "$(date -u +%FT%TZ) BACKUP FAILED: $1" >&2
    rm -f "$backup_path"/*.partial
    exit 1
}

case "${1:-once}" in
    once)
        take_backup
        ;;
    schedule)
        cron_line="${BACKUP_CRON:-0 * * * *}"
        # crond does not pass the environment on, so save what pg_dump needs.
        env | grep -E '^(PG|BACKUP_)' | sed 's/^/export /; s/=\(.*\)$/="\1"/' > /etc/backup.env
        echo "$cron_line . /etc/backup.env && /scripts/backup.sh once >> /proc/1/fd/1 2>&1" > /etc/crontabs/root
        echo "Backup schedule: $cron_line -> $backup_path (keeping $keep_count)"
        take_backup
        exec crond -f -l 8
        ;;
    *)
        echo "usage: backup.sh once|schedule" >&2
        exit 2
        ;;
esac
