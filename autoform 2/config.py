"""
autoform/config.py
Central configuration. Set credentials via environment variables or edit directly.
"""
import os

# CrazyTel API
CRAZYTEL_API_KEY    = os.getenv("CRAZYTEL_API_KEY",  "YOUR_CRAZYTEL_API_KEY_HERE")
CRAZYTEL_BASE_URL   = os.getenv("CRAZYTEL_BASE_URL", "https://api.crazytel.com.au/v1")
CRAZYTEL_COUNTRY    = os.getenv("CRAZYTEL_COUNTRY",  "AU")
SMS_POLL_TIMEOUT    = int(os.getenv("SMS_POLL_TIMEOUT",  "120"))
SMS_POLL_INTERVAL   = int(os.getenv("SMS_POLL_INTERVAL", "5"))

# Browser
DEFAULT_BROWSER_MODE = os.getenv("BROWSER_MODE", "visible")
SLOW_MO              = int(os.getenv("SLOW_MO", "50"))
NAVIGATION_TIMEOUT   = int(os.getenv("NAVIGATION_TIMEOUT", "30000"))
ACTION_TIMEOUT       = int(os.getenv("ACTION_TIMEOUT",     "10000"))

# CSV
DEFAULT_CSV_PATH = os.getenv("CSV_PATH", "sample_data.csv")

# Logging
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
LOG_FILE  = os.getenv("LOG_FILE",  "autoform.log")
# Proxy (optional - use residential proxy to bypass IP blocks)
# Format: "http://user:pass@host:port" or "socks5://host:port"
PROXY_SERVER   = os.getenv("PROXY_SERVER",   "")   # e.g. "http://proxy.com:8080"
PROXY_USERNAME = os.getenv("PROXY_USERNAME", "")
PROXY_PASSWORD = os.getenv("PROXY_PASSWORD", "")