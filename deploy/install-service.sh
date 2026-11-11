#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer with sudo."
  exit 1
fi
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node=/opt/survey/runtime/bin/node
if [ ! -x "$node" ] || [ ! -f "$root/dist/index.html" ]; then
  echo "Install the isolated Node 24 runtime and run npm ci, npm test, npm run build first."
  exit 1
fi
if [ ! -f /etc/survey/survey.env ]; then
  echo "Create an owner-only /etc/survey/survey.env using .env.example before installing."
  exit 1
fi
ENV_FILE=/etc/survey/survey.env "$node" --input-type=module -e "import {loadEnvironment,getConfig} from 'file://$root/server/config.js'; loadEnvironment(); getConfig();"
if ! id survey-workspace >/dev/null 2>&1; then
  useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin survey-workspace
fi
install -d -m 0755 /opt/survey/releases
install -d -o survey-workspace -g survey-workspace -m 0700 /var/lib/survey
release="/opt/survey/releases/$(date -u +%Y%m%dT%H%M%SZ)"
if [ -e "$release" ]; then
  echo "A release with this timestamp already exists; retry in a moment."
  exit 1
fi
install -d -m 0755 "$release" "$release/dist" "$release/server" "$release/src/lib"
cp -R "$root/dist/." "$release/dist/"
cp -R "$root/server/." "$release/server/"
cp "$root/src/lib/surveyEngine.js" "$root/src/lib/definition.js" "$release/src/lib/"
cp "$root/package.json" "$release/"
find "$release" -type d -exec chmod 0755 {} +
find "$release" -type f -exec chmod 0644 {} +
chown -R survey-workspace:survey-workspace /var/lib/survey
chmod 0600 /etc/survey/survey.env
install -m 0644 "$root/deploy/survey-workspace.service" /etc/systemd/system/survey-workspace.service
install -m 0644 "$root/deploy/survey-workspace-backup.service" /etc/systemd/system/survey-workspace-backup.service
install -m 0644 "$root/deploy/survey-workspace-backup.timer" /etc/systemd/system/survey-workspace-backup.timer
previous="$(readlink /opt/survey/app || true)"
ln -s "$release" "$release.link"
mv -Tf "$release.link" /opt/survey/app
systemctl daemon-reload
systemctl enable survey-workspace.service survey-workspace-backup.timer
systemctl restart survey-workspace.service
systemctl start survey-workspace-backup.timer
port="$(ENV_FILE=/etc/survey/survey.env "$node" --input-type=module -e "import {loadEnvironment,getConfig} from 'file://$root/server/config.js'; loadEnvironment(); console.log(getConfig().port);")"
if ! curl --fail --silent --retry 10 --retry-connrefused --retry-delay 1 "http://127.0.0.1:$port/api/health"; then
  if [ -n "$previous" ] && [ -d "$previous" ]; then
    ln -s "$previous" "$release.rollback"
    mv -Tf "$release.rollback" /opt/survey/app
    systemctl restart survey-workspace.service
    echo "Health check failed; previous application release restored."
  else
    echo "Health check failed; inspect the service journal."
  fi
  exit 1
fi
echo
echo "Survey service installed; database and credentials stay outside application releases."
