import unittest
from unittest.mock import MagicMock, patch
import sys
import os
import asyncio

# Add the backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from main import get_dns_details, dns_records, dns_aggregates, get_http_details
from auth import get_user_by_email

class TestVulnerabilities(unittest.IsolatedAsyncioTestCase):
    @patch('auth.get_ch_client')
    def test_sql_injection_get_user_by_email(self, mock_get_client):
        # Mock the clickhouse client and its query method
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        # Define a mock result for the query
        mock_result = MagicMock()
        mock_result.result_rows = []
        mock_client.query.return_value = mock_result

        # malicious email
        malicious_email = "' OR 1=1 --"

        # Call the function
        get_user_by_email(malicious_email)

        # Check what query was executed
        args, kwargs = mock_client.query.call_args
        executed_query = args[0]
        parameters = kwargs.get('parameters', {})

        # Verify that the query is parameterized
        self.assertIn("email = {email:String}", executed_query)
        self.assertEqual(parameters.get('email'), malicious_email)
        self.assertNotIn(f"'{malicious_email}'", executed_query)

    @patch('main.ch_client')
    async def test_sql_injection_get_dns_details(self, mock_ch_client):
        # Mock results
        mock_result = MagicMock()
        mock_result.result_rows = []
        mock_ch_client.query.return_value = mock_result

        malicious_file_id = "' OR 1=1 --"

        await get_dns_details(malicious_file_id, {})

        args, kwargs = mock_ch_client.query.call_args
        executed_query = args[0]
        parameters = kwargs.get('parameters', {})

        # Verify
        self.assertIn("pcap_id = {file_id:String}", executed_query)
        self.assertEqual(parameters.get('file_id'), malicious_file_id)
        self.assertNotIn(f"'{malicious_file_id}'", executed_query)

    @patch('main.ch_client')
    async def test_sql_injection_dns_records(self, mock_ch_client):
        mock_result = MagicMock()
        mock_result.result_rows = []
        mock_ch_client.query.return_value = mock_result

        malicious_file_id = "' OR 1=1 --"
        malicious_search = "'; DROP TABLE users; --"

        # Mocking total count query result as well
        mock_ch_client.query.side_effect = [mock_result, MagicMock(result_rows=[[0]])]

        await dns_records(malicious_file_id, search=malicious_search, current_user={})

        # Check calls
        # We expect 2 calls: one for records, one for count
        self.assertEqual(mock_ch_client.query.call_count, 2)

        args, kwargs = mock_ch_client.query.call_args_list[0]
        executed_query = args[0]
        parameters = kwargs.get('parameters', {})

        self.assertIn("pcap_id = {file_id:String}", executed_query)
        self.assertIn("position(lower(query), {search:String}) > 0", executed_query)
        self.assertEqual(parameters.get('file_id'), malicious_file_id)
        self.assertEqual(parameters.get('search'), malicious_search.lower())

    @patch('main.ch_client')
    async def test_sql_injection_get_http_details(self, mock_ch_client):
        mock_result = MagicMock()
        mock_result.result_rows = []
        mock_ch_client.query.return_value = mock_result

        malicious_file_id = "' OR 1=1 --"

        await get_http_details(malicious_file_id, {})

        args, kwargs = mock_ch_client.query.call_args
        executed_query = args[0]
        parameters = kwargs.get('parameters', {})

        self.assertIn("pcap_id = {file_id:String}", executed_query)
        self.assertEqual(parameters.get('file_id'), malicious_file_id)

if __name__ == '__main__':
    unittest.main()
