#!/usr/bin/env sh
# Start OKgram from source (Linux, macOS). Needs Node.js 20 or newer.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js není nainstalovaný: https://nodejs.org"; exit 1; }
if [ ! -d node_modules ]; then
  echo "Instaluji závislosti..."
  npm install
fi
npm run dev
