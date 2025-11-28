import sys
import os
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from datetime import datetime

# Add backend to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import app
from auth import get_current_user

# Dummy user for overriding authentication
def mock_get_current_user():
    return {"id": "test-user-id", "email": "test@example.com"}

client = TestClient(app)

# Helper to create mock clickhouse client
@pytest.fixture
def mock_ch_client():
    with patch('main.get_ch_client') as mock:
        yield mock

# Helper to override auth
@pytest.fixture
def override_auth():
    app.dependency_overrides[get_current_user] = mock_get_current_user
    yield
    app.dependency_overrides = {}

def test_root():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "PCAP Analyzer API", "status": "running"}

def test_list_projects(mock_ch_client, override_auth):
    # Setup mock return value
    mock_client_instance = MagicMock()
    mock_ch_client.return_value = mock_client_instance

    # Mock result for: SELECT id, name, created_at FROM projects ...
    mock_result = MagicMock()
    # ClickHouse result_rows is usually a list of tuples
    mock_result.result_rows = [
        ("project-1", "My Project", datetime(2023, 1, 1, 12, 0, 0))
    ]
    mock_client_instance.query.return_value = mock_result

    response = client.get("/api/projects")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["id"] == "project-1"
    assert data[0]["name"] == "My Project"
    # ISO format check
    assert "2023-01-01" in data[0]["created_at"]

def test_create_project(mock_ch_client, override_auth):
    mock_client_instance = MagicMock()
    mock_ch_client.return_value = mock_client_instance

    response = client.post("/api/projects", json={"name": "New Project"})

    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New Project"
    assert "id" in data

    # Verify insert command was called
    # The exact query string might change, but we check if command was called
    mock_client_instance.command.assert_called_once()
    args, _ = mock_client_instance.command.call_args
    assert "INSERT INTO projects" in args[0]

def test_analyze_pcap(mock_ch_client, override_auth):
    mock_client_instance = MagicMock()
    mock_ch_client.return_value = mock_client_instance

    # We need to mock multiple queries for analyze_pcap
    # 1. Metadata
    # 2. Protocols
    # 3. Top Sources
    # 4. Top Destinations
    # 5. Traffic over time
    # 6. Traffic by protocol

    # We can use side_effect to return different results for different calls
    # However, since the code might change order or add queries, checking exact order is brittle.
    # But for a unit test with fixed code, it's acceptable, or we can use a more smart mock if needed.

    # Let's inspect the code logic again.
    # main.py calls:
    # 1. SELECT total_packets, file_size, capture_duration FROM pcap_metadata ...
    # 2. SELECT protocol, COUNT() FROM packets ...
    # 3. SELECT src_ip, COUNT(), SUM(length) ...
    # 4. SELECT dst_ip, COUNT(), SUM(length) ...
    # 5. SELECT toStartOfInterval ... (traffic over time)
    # 6. SELECT toStartOfInterval ... (traffic by protocol)

    meta_res = MagicMock(result_rows=[(100, 102400, 60.0)])
    protos_res = MagicMock(result_rows=[("TCP", 80), ("UDP", 20)])
    src_res = MagicMock(result_rows=[("192.168.1.1", 50, 50000)])
    dst_res = MagicMock(result_rows=[("8.8.8.8", 50, 50000)])
    traffic_time_res = MagicMock(result_rows=[(datetime(2023, 1, 1, 10, 0, 0), 10)])
    traffic_proto_res = MagicMock(result_rows=[(datetime(2023, 1, 1, 10, 0, 0), "TCP", 10)])

    mock_client_instance.query.side_effect = [
        meta_res,
        protos_res,
        src_res,
        dst_res,
        traffic_time_res,
        traffic_proto_res
    ]

    file_id = "test-file-id"
    response = client.get(f"/api/analyze/{file_id}")

    assert response.status_code == 200
    data = response.json()

    assert data["file_id"] == file_id
    assert data["packet_count"] == 100
    assert data["protocols"] == {"TCP": 80, "UDP": 20}
    assert len(data["top_sources"]) == 1
    assert data["top_sources"][0]["ip"] == "192.168.1.1"

def test_login_success(mock_ch_client):
    # For login, we need to mock get_user_by_email in auth.py
    # Since main.py imports it, we should patch where it's used or mock the DB call inside it.
    # get_user_by_email calls get_ch_client().query(...)

    mock_client_instance = MagicMock()
    mock_ch_client.return_value = mock_client_instance

    # Mock user exists
    # SELECT id, email, password_hash, created_at ...
    # We need a valid hash for the password "password"
    # Let's generate a real hash or mock verify_password

    # IMPORTANT: We need to patch verify_password in 'main' because it's imported there
    # But get_user_by_email is imported from auth, so we need to ensure get_user_by_email inside auth
    # uses the mocked client.

    # The issue might be that get_user_by_email inside auth.py calls get_ch_client() from database.py.
    # Our fixture patches 'main.get_ch_client'.
    # But auth.py imports get_ch_client from database.py independently.
    # So patching 'main.get_ch_client' DOES NOT affect 'auth.get_ch_client'.

    # We need to patch 'auth.get_ch_client' as well or patch 'database.get_ch_client'.

    with patch('auth.get_ch_client') as mock_auth_client_getter:
        mock_auth_client_getter.return_value = mock_client_instance

        with patch('main.verify_password') as mock_verify:
            mock_verify.return_value = True

            mock_result = MagicMock()
            mock_result.result_rows = [("user-1", "test@example.com", "hashed_pw", datetime.now())]
            mock_client_instance.query.return_value = mock_result

            response = client.post("/api/auth/login", json={"email": "test@example.com", "password": "password"})

            # Print response for debugging if it fails
            if response.status_code != 200:
                print(f"Login failed: {response.text}")

            assert response.status_code == 200
            data = response.json()
            assert "access_token" in data
            assert data["token_type"] == "bearer"
