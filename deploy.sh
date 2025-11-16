#! /bin/bash

ssh hetzner "cd /var/www/musicality-nerd && git checkout . && git pull && /root/.bun/bin/bun install && PORT=3006 /root/.bun/bin/bun run build"