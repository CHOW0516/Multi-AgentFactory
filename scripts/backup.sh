#!/bin/sh
# Runs inside the `backup` compose service (postgres:16-alpine).
#   backup.sh schedule  -> installs BACKUP_CRON for busybox crond and runs it in the foreground
#   backup.sh once      -> takes one pg_dump now
# Dumps go to BACKUP_PATH as factory-YYYYMMDD-HHMMSS.dump (custom format, for pg_restore).
# Only the newest BACKUP_KEEP dumps are kept (default 72 = three days of hourly dumps).
set -eu

backup_path="${BACKUP_PATH:-/backups}"
keep_count="${BACKUP_KEEP:-72}"

take_backup() {
    mkdir -p "$backup_path"
    file_name="$backup_path/factory-$(date -u +%Y%m%d-%H%M%S).dump"
    # Write to a temp name first so a half-written dump never looks like a good one.
    pg_dump --format=custom --file="$file_name.partial" && mv "$file_name.partial" "$file_name"
    echo "$(date -u +%FT%TZ) backup written: $file_name"
    # Remove the oldest dumps beyond the keep count.
    ls -1 "$backup_path"/factory-*.dump 2>/dev/null | sort -r | tail -n +"$((keep_count + 1))" | xargs -r rm -f
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
