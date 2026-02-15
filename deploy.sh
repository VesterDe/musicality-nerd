#! /bin/bash

ssh hetzner "cd /var/www/musicality-nerd && git checkout . && git pull && /usr/local/bin/bun install && /usr/local/bin/bun run build"