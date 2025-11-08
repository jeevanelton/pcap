import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Search, Filter, Copy } from 'lucide-react';
import { authFetch } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config';

const API_BASE = API_BASE_URL;

interface Packet {
  number: number;
  time: string;
  src_ip?: string;
  dst_ip?: string;
  src_port?: number;
  dst_port?: number;
  protocol: string;
  length: number;
  info?: string;
}

interface PacketDetail {
  packet_number: number;
  timestamp: string;
  layers: any;
  raw_hex?: string;
  raw_ascii?: string;
}

interface WiresharkPacketViewerProps {
  fileId: string;
  packetsData: { packets: Packet[]; total_returned: number };
}

const WiresharkPacketViewer: React.FC<WiresharkPacketViewerProps> = ({ fileId, packetsData }) => {
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);
  const [packetDetail, setPacketDetail] = useState<PacketDetail | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [filterProtocol, setFilterProtocol] = useState('all');
  const [loading, setLoading] = useState(false);

  const packets = packetsData?.packets || [];

  // Format time to show seconds with microseconds (like Wireshark)
  const formatTime = (timeStr: string) => {
    try {
      const date = new Date(timeStr);
      const seconds = date.getSeconds() + (date.getMilliseconds() / 1000);
      return seconds.toFixed(6);
    } catch {
      return timeStr;
    }
  };

  // Get unique protocols for filter
  const uniqueProtocols = ['all', ...new Set(packets.map(p => p.protocol))];

  // Filter packets
  const filteredPackets = packets.filter(packet => {
    const matchesSearch = !searchTerm || 
      packet.src_ip?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      packet.dst_ip?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      packet.protocol.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesFilter = filterProtocol === 'all' || packet.protocol === filterProtocol;
    
    return matchesSearch && matchesFilter;
  });

  // Fetch packet details
  const fetchPacketDetail = async (packet: Packet) => {
    setLoading(true);
    try {
      const response = await authFetch(`${API_BASE}/api/packet/${fileId}/${packet.number}`);
      if (!response.ok) throw new Error('Failed to fetch packet details');
      const data = await response.json();
      setPacketDetail(data);
    } catch (error) {
      console.error('Failed to fetch packet details:', error);
      setPacketDetail(null);
    } finally {
      setLoading(false);
    }
  };

  // Handle packet selection
  const handlePacketClick = (packet: Packet) => {
    setSelectedPacket(packet);
    fetchPacketDetail(packet);
  };

  // Toggle layer expansion
  const toggleLayer = (layerKey: string) => {
    const newExpanded = new Set(expandedLayers);
    if (newExpanded.has(layerKey)) {
      newExpanded.delete(layerKey);
    } else {
      newExpanded.add(layerKey);
    }
    setExpandedLayers(newExpanded);
  };

  // Render layer tree recursively
  const renderLayer = (key: string, value: any, level: number = 0, parentKey: string = '') => {
    const uniqueKey = `${parentKey}_${key}`;
    const isExpanded = expandedLayers.has(uniqueKey);
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);
    const isArray = Array.isArray(value);

    // Skip rendering arrays directly, render their contents instead
    if (isArray) {
      return (
        <div key={uniqueKey}>
          {value.map((item, idx) => renderLayer(`${key}[${idx}]`, item, level, parentKey))}
        </div>
      );
    }

    return (
      <div key={uniqueKey} style={{ marginLeft: `${level * 16}px` }} className="border-l border-gray-700">
        <div
          className={`py-1 px-2 hover:bg-gray-700 cursor-pointer flex items-center font-mono text-xs ${
            isObject ? 'text-blue-400 font-semibold' : 'text-gray-300'
          }`}
          onClick={() => isObject && toggleLayer(uniqueKey)}
        >
          {isObject && (
            <span className="mr-1">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          )}
          <span className="text-yellow-400 mr-2">{key}:</span>
          {!isObject && <span className="text-green-400">{String(value)}</span>}
        </div>
        {isObject && isExpanded && (
          <div>
            {Object.entries(value).map(([k, v]) => renderLayer(k, v, level + 1, uniqueKey))}
          </div>
        )}
      </div>
    );
  };

  // Generate hex dump
  const generateHexDump = () => {
    if (!packetDetail) return null;

    // If raw_hex is not available, show a placeholder
    if (!packetDetail.raw_hex) {
      return (
        <div className="p-4 text-center text-gray-500">
          <p className="mb-2">Hex dump not available for this packet</p>
          <p className="text-xs">Raw packet data is not stored in the database</p>
        </div>
      );
    }

    const hex = packetDetail.raw_hex;
    const lines = [];
    const bytesPerLine = 16;

    for (let i = 0; i < hex.length; i += bytesPerLine * 2) {
      const hexChunk = hex.substr(i, bytesPerLine * 2);
      const bytes = hexChunk.match(/.{1,2}/g) || [];
      
      // Offset
      const offset = (i / 2).toString(16).padStart(4, '0');
      
      // Hex values
      const hexPart1 = bytes.slice(0, 8).join(' ').padEnd(23, ' ');
      const hexPart2 = bytes.slice(8, 16).join(' ').padEnd(23, ' ');
      
      // ASCII values
      const ascii = bytes.map(byte => {
        const charCode = parseInt(byte, 16);
        return charCode >= 32 && charCode <= 126 ? String.fromCharCode(charCode) : '.';
      }).join('');

      lines.push(
        <div key={i} className="font-mono text-xs hover:bg-gray-700 py-0.5 px-2 flex">
          <span className="text-gray-500 w-12">{offset}</span>
          <span className="text-blue-400 w-48 ml-4">{hexPart1}</span>
          <span className="text-blue-400 w-48 ml-2">{hexPart2}</span>
          <span className="text-green-400 ml-4">{ascii}</span>
        </div>
      );
    }

    return lines;
  };

  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="bg-[#2d2d2d] border-b border-gray-700 p-3 flex items-center gap-3">
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Search packets (IP, protocol...)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-1.5 bg-[#1e1e1e] border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-gray-400" />
            <select
              value={filterProtocol}
              onChange={(e) => setFilterProtocol(e.target.value)}
              className="px-3 py-1.5 bg-[#1e1e1e] border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-blue-500"
            >
              {uniqueProtocols.map(proto => (
                <option key={proto} value={proto}>
                  {proto === 'all' ? 'All Protocols' : proto}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="text-xs text-gray-400">
          {filteredPackets.length} of {packets.length} packets
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Packet List */}
        <div className="h-1/3 border-b border-gray-700 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-[#2d2d2d] sticky top-0 z-10">
              <tr className="border-b border-gray-700">
                <th className="px-3 py-2 text-left text-gray-300 font-semibold w-16">No.</th>
                <th className="px-3 py-2 text-left text-gray-300 font-semibold w-24">Time</th>
                <th className="px-3 py-2 text-left text-gray-300 font-semibold w-32">Source</th>
                <th className="px-3 py-2 text-left text-gray-300 font-semibold w-32">Destination</th>
                <th className="px-3 py-2 text-left text-gray-300 font-semibold w-20">Protocol</th>
                <th className="px-3 py-2 text-left text-gray-300 font-semibold w-20">Length</th>
                <th className="px-3 py-2 text-left text-gray-300 font-semibold">Info</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {filteredPackets.map((packet, idx) => {
                const isSelected = selectedPacket?.number === packet.number;
                const rowColor = idx % 2 === 0 ? 'bg-[#1e1e1e]' : 'bg-[#252525]';
                
                return (
                  <tr
                    key={packet.number}
                    onClick={() => handlePacketClick(packet)}
                    className={`cursor-pointer border-b border-gray-800 hover:bg-[#2a4a6a] transition-colors ${
                      isSelected ? 'bg-[#264f78] hover:bg-[#264f78]' : rowColor
                    }`}
                  >
                    <td className="px-3 py-1 text-gray-400">{packet.number}</td>
                    <td className="px-3 py-1 text-gray-300">{formatTime(packet.time)}</td>
                    <td className="px-3 py-1 text-blue-400">
                      {packet.src_ip || 'N/A'}
                      {packet.src_port ? `:${packet.src_port}` : ''}
                    </td>
                    <td className="px-3 py-1 text-purple-400">
                      {packet.dst_ip || 'N/A'}
                      {packet.dst_port ? `:${packet.dst_port}` : ''}
                    </td>
                    <td className="px-3 py-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        packet.protocol === 'DNS' ? 'bg-blue-900 text-blue-200' :
                        packet.protocol === 'HTTP' ? 'bg-green-900 text-green-200' :
                        packet.protocol === 'TLS' ? 'bg-purple-900 text-purple-200' :
                        packet.protocol === 'TCP' ? 'bg-gray-700 text-gray-200' :
                        packet.protocol === 'UDP' ? 'bg-yellow-900 text-yellow-200' :
                        'bg-gray-800 text-gray-300'
                      }`}>
                        {packet.protocol}
                      </span>
                    </td>
                    <td className="px-3 py-1 text-gray-300">{packet.length}</td>
                    <td className="px-3 py-1 text-gray-400 truncate max-w-xs">
                      {packet.info || `${packet.protocol} packet`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Packet Details */}
        <div className="h-1/3 border-b border-gray-700 overflow-auto bg-[#1e1e1e]">
          <div className="sticky top-0 bg-[#2d2d2d] border-b border-gray-700 px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">Packet Details</span>
            {packetDetail && (
              <button
                onClick={() => copyToClipboard(JSON.stringify(packetDetail.layers, null, 2))}
                className="px-2 py-1 text-xs bg-[#1e1e1e] border border-gray-600 rounded hover:bg-[#252525] flex items-center gap-1 text-gray-300"
              >
                <Copy size={12} />
                Copy JSON
              </button>
            )}
          </div>
          {loading ? (
            <div className="p-4 text-center text-gray-400">Loading packet details...</div>
          ) : packetDetail ? (
            <div className="p-2">
              {packetDetail.layers && Array.isArray(packetDetail.layers) ? (
                packetDetail.layers.map((layer: any, idx: number) => (
                  <div key={idx}>
                    {renderLayer(layer.name || `Layer ${idx}`, layer.fields || layer, 0, `layer_${idx}`)}
                  </div>
                ))
              ) : (
                <div className="p-4 text-center text-gray-500">No layer data available</div>
              )}
            </div>
          ) : selectedPacket ? (
            <div className="p-4 text-center text-gray-400">
              Click on a packet to view details
            </div>
          ) : (
            <div className="p-4 text-center text-gray-500">
              Select a packet from the list above
            </div>
          )}
        </div>

        {/* Hex Dump */}
        <div className="h-1/3 overflow-auto bg-[#1e1e1e]">
          <div className="sticky top-0 bg-[#2d2d2d] border-b border-gray-700 px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-300">Packet Bytes</span>
            {packetDetail?.raw_hex && (
              <button
                onClick={() => copyToClipboard(packetDetail.raw_hex || '')}
                className="px-2 py-1 text-xs bg-[#1e1e1e] border border-gray-600 rounded hover:bg-[#252525] flex items-center gap-1 text-gray-300"
              >
                <Copy size={12} />
                Copy Hex
              </button>
            )}
          </div>
          <div className="p-2">
            {loading ? (
              <div className="text-center text-gray-400 py-4">Loading...</div>
            ) : packetDetail ? (
              generateHexDump()
            ) : (
              <div className="p-4 text-center text-gray-500">
                Select a packet to view hex dump
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WiresharkPacketViewer;
