import React, { useEffect, useState } from 'react';
import { authFetch } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/config';
import { RefreshCw, Search } from 'lucide-react';

interface AnalysisViewProps {
  fileId: string;
  type: 'ports' | 'connections' | 'hosts' | 'servers' | 'credentials';
  title: string;
}

export const AnalysisView: React.FC<AnalysisViewProps> = ({ fileId, type, title }) => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      let endpoint = '';
      switch (type) {
        case 'ports': endpoint = `/api/details/ports/${fileId}`; break;
        case 'connections': endpoint = `/api/details/connections/${fileId}`; break;
        // For hosts/servers we might need new endpoints or reuse existing logic
        // For now let's assume we have them or use placeholders
        default: endpoint = `/api/details/${type}/${fileId}`; break;
      }
      
      const res = await authFetch(`${API_BASE_URL}${endpoint}`);
      if (res.ok) {
        const json = await res.json();
        // Normalize data based on type
        if (type === 'ports') setData(json.ports || []);
        else if (type === 'connections') setData(json.connections || []);
        else if (type === 'credentials') setData([]); // Placeholder
        else setData([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fileId, type]);

  const renderTable = () => {
    if (type === 'ports') {
      return (
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-100 text-gray-700 uppercase tracking-wider font-medium text-xs">
            <tr>
              <th className="p-3">Port</th>
              <th className="p-3">Protocol</th>
              <th className="p-3">Service</th>
              <th className="p-3">Connections</th>
              <th className="p-3">Bytes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="p-3 font-mono text-indigo-600">{row.port}</td>
                <td className="p-3">{row.protocol}</td>
                <td className="p-3">{row.service}</td>
                <td className="p-3">{row.connections}</td>
                <td className="p-3">{row.bytes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (type === 'connections') {
      return (
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-100 text-gray-700 uppercase tracking-wider font-medium text-xs">
            <tr>
              <th className="p-3">Source</th>
              <th className="p-3">Destination</th>
              <th className="p-3">Protocol</th>
              <th className="p-3">Packets</th>
              <th className="p-3">Bytes</th>
              <th className="p-3">Duration (s)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="p-3 font-mono text-indigo-600">{row.source}</td>
                <td className="p-3 font-mono text-indigo-600">{row.destination}</td>
                <td className="p-3">{row.protocol}</td>
                <td className="p-3">{row.packets}</td>
                <td className="p-3">{row.bytes}</td>
                <td className="p-3">{row.duration?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    return <div className="p-8 text-center text-gray-500">View not implemented yet.</div>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
        <button onClick={fetchData} className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full">
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : renderTable()}
        </div>
      </div>
    </div>
  );
};
