#! /bin/bash

ssh hetzner "cd /var/www/musicality-nerd && git checkout master && git pull && PORT=3006 /root/.bun/bin/bun run build && supervisorctl restart musicality"