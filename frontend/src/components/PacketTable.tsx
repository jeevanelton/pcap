import React, { useState } from 'react';
import { DataTable } from './ui/DataTable';
import PacketDetailModal from './PacketDetailModal';
import { authFetch } from '../contexts/AuthContext';

const API_BASE = 'http://localhost:8000';

interface Packet {
  number: number; // Added packet number for detail fetching
  time: string;
  src_ip?: string;
  dst_ip?: string;
  protocol: string;
  length: number;
  info?: string;
}

interface PacketTableProps {
  fileId: string;
  packetsData: { packets: Packet[]; total_returned: number }; // Updated to match backend response structure
}

const columns = [
  { header: 'Time', accessor: 'time' },
  { header: 'Source IP', accessor: 'src_ip' },
  { header: 'Destination IP', accessor: 'dst_ip' },
  { header: 'Protocol', accessor: 'protocol' },
  { header: 'Length', accessor: 'length' },
  { 
    header: 'Info', 
    cell: (value: any, row: Packet) => {
      const protocol = row?.protocol || 'Unknown';
      const srcIp = row?.src_ip || 'N/A';
      const dstIp = row?.dst_ip || 'N/A';
      return `${protocol} packet from ${srcIp} to ${dstIp}`;
    }
  },
];

const PacketTable: React.FC<PacketTableProps> = ({ fileId, packetsData }) => {
  console.log('[DEBUG] PacketTable received packetsData:', packetsData);
  const packets = packetsData?.packets || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPacketDetail, setSelectedPacketDetail] = useState<any>(null);

  const handleRowClick = async (packet: Packet) => {
    try {
      const response = await authFetch(`${API_BASE}/api/packet/${fileId}/${packet.number}`);
      if (!response.ok) throw new Error('Failed to fetch packet details');
      const data = await response.json();
      setSelectedPacketDetail(data);
      setIsModalOpen(true);
    } catch (error) {
      console.error('Failed to fetch packet details:', error);
      // Optionally, show an error message to the user
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedPacketDetail(null);
  };

  return (
    <div>
      {packets.length > 0 ? (
        <DataTable data={packets} columns={columns} onRowClick={handleRowClick} />
      ) : (
        <p>No packet data available.</p>
      )}
      <PacketDetailModal 
        isOpen={isModalOpen} 
        onClose={handleCloseModal} 
        packet={selectedPacketDetail} 
      />
    </div>
  );
};

export default PacketTable;
