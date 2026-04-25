# Deployment Guide

## Primary deployment: systemd timer

1. Copy the project to a Linux server or VPS.
2. Create a `.env` file from `.env.example`.
3. Verify config:

```bash
python3 -m app.cli check-config --show
```

4. Copy `scripts/run_daily.sh` to a stable path and make it executable:

```bash
chmod +x scripts/run_daily.sh
```

5. Create `/etc/systemd/system/kenji-digest.service`:

```ini
[Unit]
Description=Kenji daily email digest

[Service]
Type=oneshot
WorkingDirectory=/opt/kenji-digest
ExecStart=/opt/kenji-digest/scripts/run_daily.sh
Environment=PYTHONUNBUFFERED=1
```

6. Create `/etc/systemd/system/kenji-digest.timer`:

```ini
[Unit]
Description=Run Kenji digest at 21:00 Asia/Hong_Kong

[Timer]
OnCalendar=*-*-* 21:00:00 Asia/Hong_Kong
Persistent=true

[Install]
WantedBy=timers.target
```

7. Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now kenji-digest.timer
sudo systemctl status kenji-digest.timer
```

## Backup deployment: cron

Use the server timezone or export `TZ=Asia/Hong_Kong` in crontab.

```cron
TZ=Asia/Hong_Kong
0 21 * * * cd /opt/kenji-digest && /usr/bin/python3 -m app.cli run >> /opt/kenji-digest/var/logs/cron.log 2>&1
```

## Duplicate prevention

- `state.sqlite3` stores processed email IDs.
- `last_successful_digest_date` blocks same-day duplicate digest sends unless `--force` is used.
- Each processed Microsoft Graph message ID is stored after successful analysis.

## Timezone

- App timezone is controlled by `APP_TIMEZONE`.
- For cron, set `TZ=Asia/Hong_Kong`.
- For systemd timer, specify the timezone in `OnCalendar`.

