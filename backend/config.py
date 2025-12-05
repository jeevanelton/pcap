import os

# ClickHouse Configuration (support multiple env var names)
CH_HOST = (
	os.getenv("CH_HOST")
	or os.getenv("CLICKHOUSE_HOST")
	or "localhost"
)
# Prefer explicit HTTP port; fallback to CH_PORT; default 8123 for HTTP client
CH_PORT = int(
	os.getenv("CH_PORT")
	or os.getenv("CLICKHOUSE_HTTP_PORT")
	or os.getenv("CLICKHOUSE_PORT", 8123)
)
CH_USER = os.getenv("CH_USER") or os.getenv("CLICKHOUSE_USER", "default")
CH_PASSWORD = os.getenv("CH_PASSWORD")
if CH_PASSWORD is None:
    CH_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "password")

CH_DATABASE = (
	os.getenv("CH_DATABASE")
	or os.getenv("CLICKHOUSE_DATABASE")
	or os.getenv("CLICKHOUSE_DB")
	or "pcap_db"
)

# Auth config
SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24))
