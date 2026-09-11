# coolmigrate

Moves an application and its databases from one Coolify server to another with one click. Works across separate Coolify instances or between servers managed by the same instance.

## Install

```bash
npm i -g coolmigrate        # from npm
npm i -g github:maxwellvn/coolmigrate   # or straight from GitHub
coolmigrate                 # starts the server and opens the browser
```

Options: `--port 3456`, `--host 127.0.0.1`, `--no-open`, `--data ~/.coolmigrate`. Settings, history and the encryption secret live in `~/.coolmigrate`. Stop with Ctrl+C or the button in Settings.

For development: `npm install && npm run dev`.

Open http://localhost:3456/settings and add each Coolify instance: name, API URL (`http://host:8000`), an API token from Security » API Tokens, and SSH host plus root password or private key. Press Test to confirm both API and SSH work.

## What a migration does

1. Creates the destination project and environment if missing.
2. For each selected database: creates the same type and image on the destination, waits until it runs, then streams a dump from the source container into the new container over SSH. Nothing touches disk on either server.
3. Creates the application on the destination with the same repo, branch, build pack, ports, health check, limits and commands.
4. Copies every environment variable, rewriting the old database hostnames (and any renamed users, database names or regenerated passwords) to the new ones.
5. Optionally deploys and waits for a running status.

The source is never changed. After verifying the new copy, point DNS at the new server and stop the source app yourself in Coolify.

## Known limits

- The Coolify API only accepts database identifiers matching `^[A-Za-z_][A-Za-z0-9_]{0,62}$` and passwords from a restricted charset. Values created through the UI that break this rule are sanitized (hyphens become underscores, offending passwords are regenerated) and the app's env vars are rewritten to match. The log states every such change.
- Private repos need a GitHub App installed on the destination instance with access to that repo. Pick it in the form. GitHub App installations differ per instance even when they use the same GitHub account.
- Redis is copied as an RDB snapshot installed as the AOF base file, then restarted. Writes between the snapshot and the restart are lost.
- Application volumes and upload directories are copied with tar over SSH before the first deploy.
- Before anything is created the tool measures the data to move and refuses to start when the destination has less than 1.5x that plus 3 GB free, or under 512 MB of memory available.
- A Coolify instance that manages remote servers needs each remote server added in Settings as well, so its containers can be reached over SSH.
- Docker Compose services are not supported.
- One migration runs at a time, in process. Restarting the server mid-migration abandons it; the log shows where it stopped and the created resources are listed so you can delete them in Coolify.

## Security

Tokens and passwords are stored AES-256-GCM encrypted in `~/.coolmigrate/app.db`, keyed by `~/.coolmigrate/secret` (generated on first run, or `APP_SECRET` if set). The app has no login screen: run it on your own machine or put it behind an authenticating proxy before exposing it.
