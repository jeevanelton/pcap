import clickhouse_connect
from config import CH_HOST, CH_PORT, CH_USER, CH_PASSWORD

print(f"Connecting to {CH_HOST}:{CH_PORT} as {CH_USER}...")
try:
    client = clickhouse_connect.get_client(
        host=CH_HOST,
        port=CH_PORT,
        username=CH_USER,
        password=CH_PASSWORD,
        database="default"
    )
    print("Connected successfully!")
    print(client.command("SELECT 1"))
except Exception as e:
    print(f"Connection failed: {e}")
