import React, { useEffect, useState } from 'react';
import { X, Download, Search, Filter } from 'lucide-react';
import { authFetch } from '../contexts/AuthContext';

const API_BASE = 'http://localhost:8000';

interface FeatureDetailModalProps {
  featureKey: string;
  featureTitle: string;
  fileId: string;
  onClose: () => void;
}

const FeatureDetailModal: React.FC<FeatureDetailModalProps> = ({ featureKey, featureTitle, fileId, onClose }) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    fetchData();
  }, [featureKey, fileId]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = getEndpointForFeature(featureKey);
      if (!endpoint) {
        setError('Feature not yet implemented');
        setLoading(false);
        return;
      }

      const response = await authFetch(`${API_BASE}${endpoint}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getEndpointForFeature = (key: string): string | null => {
    const endpoints: Record<string, string> = {
      'dns': `/api/details/dns/${fileId}`,
      'http': `/api/details/http/${fileId}`,
      'ssl': `/api/details/tls/${fileId}`,
      'open_ports': `/api/details/ports/${fileId}`,
      'connections': `/api/details/connections/${fileId}`,
      'arp': `/api/details/arp/${fileId}`,
      'smb': `/api/details/smb/${fileId}`,
    };
    return endpoints[key] || null;
  };

  const exportData = () => {
    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${featureKey}_${fileId}.json`;
    link.click();
  };

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <p className="text-red-600 mb-2">{error}</p>
            <button onClick={fetchData} className="text-indigo-600 hover:text-indigo-800">
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (!data) return null;

    switch (featureKey) {
      case 'dns':
        return <DNSView data={data} searchTerm={searchTerm} />;
      case 'http':
        return <HTTPView data={data} searchTerm={searchTerm} />;
      case 'ssl':
        return <TLSView data={data} searchTerm={searchTerm} />;
      case 'open_ports':
        return <PortsView data={data} searchTerm={searchTerm} />;
      case 'connections':
        return <ConnectionsView data={data} searchTerm={searchTerm} />;
      case 'arp':
        return <ARPView data={data} searchTerm={searchTerm} />;
      case 'smb':
        return <SMBView data={data} searchTerm={searchTerm} />;
      default:
        return <div className="text-gray-600">Feature view not implemented</div>;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">{featureTitle}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {data && `Total: ${data.total || data.total_ports || data.sessions?.length || 0} items`}
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>
            <button
              onClick={exportData}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2"
            >
              <Download className="h-4 w-4" />
              <span>Export</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="h-6 w-6 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

// DNS View Component
const DNSView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredQueries = data.queries?.filter((q: any) =>
    q.query.toLowerCase().includes(searchTerm.toLowerCase()) ||
    q.source.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <h3 className="text-sm font-medium text-blue-900">Total Queries</h3>
          <p className="text-2xl font-bold text-blue-600">{data.total}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <h3 className="text-sm font-medium text-green-900">Query Types</h3>
          <p className="text-2xl font-bold text-green-600">{Object.keys(data.query_types || {}).length}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <h3 className="text-sm font-medium text-purple-900">Unique Domains</h3>
          <p className="text-2xl font-bold text-purple-600">{data.top_domains?.length || 0}</p>
        </div>
      </div>

      {/* Query Types Distribution */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-3">Query Types</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(data.query_types || {}).map(([type, count]: [string, any]) => (
            <div key={type} className="bg-white p-3 rounded border border-gray-200">
              <span className="text-xs text-gray-600">{type}</span>
              <p className="text-lg font-semibold text-gray-900">{count}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top Domains */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-3">Top Domains</h3>
        <div className="space-y-2">
          {data.top_domains?.slice(0, 10).map((item: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between bg-white p-3 rounded border border-gray-200">
              <span className="text-sm text-gray-900 font-mono truncate flex-1">{item.domain}</span>
              <span className="text-sm font-semibold text-indigo-600 ml-4">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Queries Table */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Recent Queries</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100 border-b border-gray-200">
              <tr>
                <th className="text-left p-3 font-semibold text-gray-700">Time</th>
                <th className="text-left p-3 font-semibold text-gray-700">Query</th>
                <th className="text-left p-3 font-semibold text-gray-700">Type</th>
                <th className="text-left p-3 font-semibold text-gray-700">Source</th>
                <th className="text-left p-3 font-semibold text-gray-700">Destination</th>
              </tr>
            </thead>
            <tbody>
              {filteredQueries.map((query: any, idx: number) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 text-gray-600">{new Date(query.time).toLocaleTimeString()}</td>
                  <td className="p-3 text-gray-900 font-mono text-xs">{query.query}</td>
                  <td className="p-3">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">{query.type}</span>
                  </td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{query.source}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{query.destination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// HTTP View Component
const HTTPView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredRequests = data.requests?.filter((r: any) =>
    r.host.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.method.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.uri.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <h3 className="text-sm font-medium text-blue-900">Total Requests</h3>
          <p className="text-2xl font-bold text-blue-600">{data.total}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <h3 className="text-sm font-medium text-green-900">Unique Hosts</h3>
          <p className="text-2xl font-bold text-green-600">{data.top_hosts?.length || 0}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <h3 className="text-sm font-medium text-purple-900">Methods</h3>
          <p className="text-2xl font-bold text-purple-600">{Object.keys(data.methods || {}).length}</p>
        </div>
        <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
          <h3 className="text-sm font-medium text-orange-900">Status Codes</h3>
          <p className="text-2xl font-bold text-orange-600">{Object.keys(data.status_codes || {}).length}</p>
        </div>
      </div>

      {/* Methods and Status Codes */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3">HTTP Methods</h3>
          <div className="space-y-2">
            {Object.entries(data.methods || {}).map(([method, count]: [string, any]) => (
              <div key={method} className="flex items-center justify-between bg-white p-2 rounded">
                <span className="text-sm font-mono">{method}</span>
                <span className="text-sm font-semibold text-indigo-600">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="font-semibold text-gray-900 mb-3">Status Codes</h3>
          <div className="space-y-2">
            {Object.entries(data.status_codes || {}).map(([code, count]: [string, any]) => (
              <div key={code} className="flex items-center justify-between bg-white p-2 rounded">
                <span className="text-sm font-mono">{code}</span>
                <span className="text-sm font-semibold text-indigo-600">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top Hosts */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-3">Top Hosts</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {data.top_hosts?.slice(0, 10).map((item: any, idx: number) => (
            <div key={idx} className="flex items-center justify-between bg-white p-3 rounded">
              <span className="text-sm font-mono truncate flex-1">{item.host}</span>
              <span className="text-sm font-semibold text-indigo-600 ml-4">{item.count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Requests Table */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Recent Requests</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-3 font-semibold text-gray-700">Time</th>
                <th className="text-left p-3 font-semibold text-gray-700">Method</th>
                <th className="text-left p-3 font-semibold text-gray-700">Host</th>
                <th className="text-left p-3 font-semibold text-gray-700">URI</th>
                <th className="text-left p-3 font-semibold text-gray-700">Source</th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.slice(0, 50).map((req: any, idx: number) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 text-gray-600">{new Date(req.time).toLocaleTimeString()}</td>
                  <td className="p-3">
                    <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-mono">{req.method}</span>
                  </td>
                  <td className="p-3 text-gray-900 font-mono text-xs">{req.host}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs truncate max-w-xs">{req.uri}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{req.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// TLS View Component
const TLSView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredSessions = data.sessions?.filter((s: any) =>
    s.sni.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.source.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <h3 className="text-sm font-medium text-blue-900">Total Sessions</h3>
          <p className="text-2xl font-bold text-blue-600">{data.total}</p>
        </div>
        <div className="bg-green-50 p-4 rounded-lg border border-green-200">
          <h3 className="text-sm font-medium text-green-900">TLS Versions</h3>
          <p className="text-2xl font-bold text-green-600">{Object.keys(data.versions || {}).length}</p>
        </div>
        <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
          <h3 className="text-sm font-medium text-purple-900">Cipher Suites</h3>
          <p className="text-2xl font-bold text-purple-600">{Object.keys(data.top_ciphers || {}).length}</p>
        </div>
      </div>

      {/* TLS Versions */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-3">TLS Versions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {Object.entries(data.versions || {}).map(([version, count]: [string, any]) => (
            <div key={version} className="bg-white p-3 rounded border border-gray-200">
              <span className="text-xs text-gray-600">{version}</span>
              <p className="text-lg font-semibold text-gray-900">{count}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Top SNI Hosts */}
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="font-semibold text-gray-900 mb-3">Top SNI Hosts</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {Object.entries(data.top_sni || {}).slice(0, 10).map(([host, count]: [string, any]) => (
            <div key={host} className="flex items-center justify-between bg-white p-3 rounded">
              <span className="text-sm font-mono truncate flex-1">{host}</span>
              <span className="text-sm font-semibold text-indigo-600 ml-4">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sessions Table */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">Recent Sessions</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-3 font-semibold text-gray-700">Time</th>
                <th className="text-left p-3 font-semibold text-gray-700">SNI</th>
                <th className="text-left p-3 font-semibold text-gray-700">Version</th>
                <th className="text-left p-3 font-semibold text-gray-700">Source</th>
                <th className="text-left p-3 font-semibold text-gray-700">Destination</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.slice(0, 50).map((session: any, idx: number) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 text-gray-600">{new Date(session.time).toLocaleTimeString()}</td>
                  <td className="p-3 text-gray-900 font-mono text-xs">{session.sni}</td>
                  <td className="p-3">
                    <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">{session.version}</span>
                  </td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{session.source}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{session.destination}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Ports View Component
const PortsView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredPorts = data.ports?.filter((p: any) =>
    p.port.toString().includes(searchTerm) ||
    p.service.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h3 className="text-sm font-medium text-blue-900">Total Open Ports</h3>
        <p className="text-2xl font-bold text-blue-600">{data.total_ports}</p>
      </div>

      {/* Ports Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-3 font-semibold text-gray-700">Port</th>
              <th className="text-left p-3 font-semibold text-gray-700">Service</th>
              <th className="text-left p-3 font-semibold text-gray-700">Protocol</th>
              <th className="text-left p-3 font-semibold text-gray-700">Connections</th>
              <th className="text-left p-3 font-semibold text-gray-700">Unique Sources</th>
              <th className="text-left p-3 font-semibold text-gray-700">Unique Destinations</th>
              <th className="text-left p-3 font-semibold text-gray-700">Bytes</th>
            </tr>
          </thead>
          <tbody>
            {filteredPorts.map((port: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3">
                  <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded font-mono font-semibold">
                    {port.port}
                  </span>
                </td>
                <td className="p-3 text-gray-900">{port.service}</td>
                <td className="p-3">
                  <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs">{port.protocol}</span>
                </td>
                <td className="p-3 text-gray-600">{port.connections.toLocaleString()}</td>
                <td className="p-3 text-gray-600">{port.unique_sources}</td>
                <td className="p-3 text-gray-600">{port.unique_destinations}</td>
                <td className="p-3 text-gray-600 font-mono text-xs">{formatBytes(port.bytes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Connections View Component
const ConnectionsView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredConns = data.connections?.filter((c: any) =>
    c.source.includes(searchTerm) ||
    c.destination.includes(searchTerm) ||
    c.protocol.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h3 className="text-sm font-medium text-blue-900">Total Connections</h3>
        <p className="text-2xl font-bold text-blue-600">{data.total}</p>
      </div>

      {/* Connections Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-3 font-semibold text-gray-700">Source</th>
              <th className="text-left p-3 font-semibold text-gray-700">Destination</th>
              <th className="text-left p-3 font-semibold text-gray-700">Protocol</th>
              <th className="text-left p-3 font-semibold text-gray-700">Packets</th>
              <th className="text-left p-3 font-semibold text-gray-700">Bytes</th>
              <th className="text-left p-3 font-semibold text-gray-700">Duration</th>
            </tr>
          </thead>
          <tbody>
            {filteredConns.slice(0, 100).map((conn: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 text-gray-900 font-mono text-xs">{conn.source}</td>
                <td className="p-3 text-gray-900 font-mono text-xs">{conn.destination}</td>
                <td className="p-3">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs">{conn.protocol}</span>
                </td>
                <td className="p-3 text-gray-600">{conn.packets.toLocaleString()}</td>
                <td className="p-3 text-gray-600 font-mono text-xs">{formatBytes(conn.bytes)}</td>
                <td className="p-3 text-gray-600">{conn.duration.toFixed(2)}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ARP View Component
const ARPView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredPackets = data.packets?.filter((p: any) =>
    p.src_ip.includes(searchTerm) ||
    p.dst_ip.includes(searchTerm) ||
    p.src_mac.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
          <h3 className="text-sm font-medium text-blue-900">Total ARP Packets</h3>
          <p className="text-2xl font-bold text-blue-600">{data.total}</p>
        </div>
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <h3 className="text-sm font-medium text-red-900">Conflicts Detected</h3>
          <p className="text-2xl font-bold text-red-600">{data.conflicts?.length || 0}</p>
        </div>
      </div>

      {/* Conflicts */}
      {data.conflicts && data.conflicts.length > 0 && (
        <div className="bg-red-50 p-4 rounded-lg border border-red-200">
          <h3 className="font-semibold text-red-900 mb-3">⚠️ ARP Conflicts (Potential Spoofing)</h3>
          <div className="space-y-2">
            {data.conflicts.map((conflict: any, idx: number) => (
              <div key={idx} className="bg-white p-3 rounded border border-red-300">
                <p className="text-sm font-semibold text-gray-900">IP: {conflict.ip}</p>
                <p className="text-xs text-gray-600 mt-1">Multiple MACs: {conflict.macs.join(', ')}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ARP Packets Table */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">ARP Packets</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="text-left p-3 font-semibold text-gray-700">Time</th>
                <th className="text-left p-3 font-semibold text-gray-700">Opcode</th>
                <th className="text-left p-3 font-semibold text-gray-700">Src IP</th>
                <th className="text-left p-3 font-semibold text-gray-700">Src MAC</th>
                <th className="text-left p-3 font-semibold text-gray-700">Dst IP</th>
                <th className="text-left p-3 font-semibold text-gray-700">Dst MAC</th>
              </tr>
            </thead>
            <tbody>
              {filteredPackets.slice(0, 100).map((packet: any, idx: number) => (
                <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 text-gray-600">{new Date(packet.time).toLocaleTimeString()}</td>
                  <td className="p-3">
                    <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">{packet.opcode}</span>
                  </td>
                  <td className="p-3 text-gray-900 font-mono text-xs">{packet.src_ip}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{packet.src_mac}</td>
                  <td className="p-3 text-gray-900 font-mono text-xs">{packet.dst_ip}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{packet.dst_mac}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// SMB View Component
const SMBView: React.FC<{ data: any; searchTerm: string }> = ({ data, searchTerm }) => {
  const filteredActivity = data.activity?.filter((a: any) =>
    a.source.includes(searchTerm) ||
    a.destination.includes(searchTerm) ||
    a.info.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
        <h3 className="text-sm font-medium text-blue-900">Total SMB Activity</h3>
        <p className="text-2xl font-bold text-blue-600">{data.total}</p>
      </div>

      {/* Activity Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="text-left p-3 font-semibold text-gray-700">Time</th>
              <th className="text-left p-3 font-semibold text-gray-700">Source</th>
              <th className="text-left p-3 font-semibold text-gray-700">Destination</th>
              <th className="text-left p-3 font-semibold text-gray-700">Info</th>
            </tr>
          </thead>
          <tbody>
            {filteredActivity.slice(0, 100).map((activity: any, idx: number) => (
              <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="p-3 text-gray-600">{new Date(activity.time).toLocaleTimeString()}</td>
                <td className="p-3 text-gray-900 font-mono text-xs">{activity.source}</td>
                <td className="p-3 text-gray-900 font-mono text-xs">{activity.destination}</td>
                <td className="p-3 text-gray-600 text-xs">{activity.info}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Helper function
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default FeatureDetailModal;
