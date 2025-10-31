import { useState } from 'react';
import axios from 'axios';
import { X } from 'lucide-react';

// UI: PacketDetailModal component
const PacketDetailModal = ({ packet, onClose }) => {
  if (!packet) return null;

  return (
    <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
          <X size={24} />
        </button>
        <h2 className="text-2xl font-bold mb-4">Packet #{packet.number} Details</h2>
        
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">General</h3>
            <p><strong>Time:</strong> {packet.sniff_time}</p>
            <p><strong>Length:</strong> {packet.length} bytes</p>
          </div>

          {packet.layers.map((layer, index) => (
            <div key={index} className="border-t border-gray-200 pt-4">
              <h3 className="text-lg font-semibold text-gray-800">{layer.name} Layer</h3>
              <ul className="list-disc list-inside ml-4">
                {Object.entries(layer.fields).map(([key, value]) => (
                  <li key={key}><strong>{key}:</strong> {String(value)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export function PacketTable({ packetsData, fileId }) {
  const [selectedPacket, setSelectedPacket] = useState(null);
  const [loadingPacketDetail, setLoadingPacketDetail] = useState(false);
  const [packetDetailError, setPacketDetailError] = useState(null);

  if (!packetsData || packetsData.packets.length === 0) {
    return <div className="text-center py-10 text-gray-500">No packets data available.</div>;
  }

  const fetchPacketDetail = async (packetNumber) => {
    setLoadingPacketDetail(true);
    setPacketDetailError(null);
    try {
      const response = await axios.get(`http://localhost:8000/api/packet/${fileId}/${packetNumber}`);
      setSelectedPacket(response.data);
    } catch (err) {
      setPacketDetailError('Failed to fetch packet details.');
      console.error(err);
    } finally {
      setLoadingPacketDetail(false);
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">#</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source IP</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Dest IP</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Protocol</th>
            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Length</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {packetsData.packets.map((packet, idx) => (
            <tr 
              key={idx} 
              className="hover:bg-gray-50 cursor-pointer"
              onClick={() => fetchPacketDetail(packet.number)}
            >
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{packet.number}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{packet.time.split(' ')[1]}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{packet.src_ip || 'N/A'}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">{packet.dst_ip || 'N/A'}</td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                  {packet.protocol}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{packet.length}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {loadingPacketDetail && <div className="text-center py-4">Loading packet details...</div>}
      {packetDetailError && <div className="text-center py-4 text-red-500">Error: {packetDetailError}</div>}

      {selectedPacket && (
        <PacketDetailModal packet={selectedPacket} onClose={() => setSelectedPacket(null)} />
      )}
    </div>
  );
}
