"""
Chiron APM - Gunicorn Configuration

Multi-worker deployment for concurrent users.

Usage:
    gunicorn main:app -c gunicorn.conf.py
"""

import multiprocessing
import os

# Server socket
bind = os.environ.get("CHIRON_BIND", "0.0.0.0:8000")

# Worker processes
# For I/O-bound app (Snowflake queries), 2-4 workers per core is reasonable.
# For a small team (3-5 users), 4 workers is plenty.
workers = int(os.environ.get("CHIRON_WORKERS", min(4, multiprocessing.cpu_count() * 2 + 1)))
worker_class = "uvicorn.workers.UvicornWorker"

# Timeout: kill worker if it doesn't respond in 60s
# (covers slow Snowflake queries — they should timeout at 30s internally)
timeout = 60
graceful_timeout = 30

# Keep-alive connections
keepalive = 5

# Restart workers after this many requests to prevent memory leaks
max_requests = 1000
max_requests_jitter = 50

# Logging
accesslog = "-"  # stdout
errorlog = "-"   # stderr
loglevel = os.environ.get("CHIRON_LOG_LEVEL", "info")

# Preload app for shared memory (saves ~50MB per worker)
preload_app = False  # Set to True if Redis is used (cache is shared anyway)

# Process naming
proc_name = "chiron-apm"
