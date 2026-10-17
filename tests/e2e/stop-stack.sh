#!/bin/sh
# Stops what start-stack.sh started.
pkill -f 'pgrst.conf' 2>/dev/null
pkill -f 'local-supabase.mjs' 2>/dev/null
pkill -f 'pages dev public' 2>/dev/null
pkill -f 'cli[.]js dev --port 878[8]' 2>/dev/null
pkill -f 'workerd' 2>/dev/null
rm -f "$(cd "$(dirname "$0")/../.." && pwd)/.dev.vars"
exit 0
