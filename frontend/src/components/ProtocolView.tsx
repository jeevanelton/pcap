import React, { useEffect, useState } from 'react';
import { authFetch } from '@/contexts/AuthContext';
import { API_BASE_URL } from '@/config';
import { Search, RefreshCw, FileText } from 'lucide-react';

interface ProtocolPacket {
  time: string;
  source: string;
  destination: string;
  info: string;
  length: number;
}

interface ProtocolViewProps {
  fileId: string;
  protocol: string;
  title: string;
  description?: string;
}

export const ProtocolView: React.FC<ProtocolViewProps> = ({ fileId, protocol, title, description }) => {
  const [packets, setPackets] = useState<ProtocolPacket[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE_URL}/api/details/generic/${fileId}?protocol=${protocol}`);
      if (res.ok) {
        const data = await res.json();
        setPackets(data.packets || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [fileId, protocol]);

  const filteredPackets = packets.filter(p => 
    p.source.toLowerCase().includes(search.toLowerCase()) ||
    p.destination.toLowerCase().includes(search.toLowerCase()) ||
    p.info.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
          {description && <p className="text-sm text-gray-600">{description}</p>}
        </div>
        <button 
          onClick={fetchData} 
          className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between bg-gray-50">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search packets..."
              className="pl-9 pr-3 py-2 w-full border rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
          <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded border">
            {filteredPackets.length} packets
          </span>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-100 text-gray-700 uppercase tracking-wider font-medium text-xs">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">Source</th>
                <th className="p-3">Destination</th>
                <th className="p-3">Length</th>
                <th className="p-3">Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-500">Loading data...</td></tr>
              ) : filteredPackets.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-gray-500">No packets found.</td></tr>
              ) : (
                filteredPackets.map((pkt, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="p-3 whitespace-nowrap text-gray-600 font-mono text-xs">{new Date(pkt.time).toLocaleTimeString()}</td>
                    <td className="p-3 font-mono text-xs text-indigo-600">{pkt.source}</td>
                    <td className="p-3 font-mono text-xs text-indigo-600">{pkt.destination}</td>
                    <td className="p-3 text-gray-600 text-xs">{pkt.length}</td>
                    <td className="p-3 text-gray-800 text-xs truncate max-w-md" title={pkt.info}>{pkt.info}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
