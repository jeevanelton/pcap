import React from 'react';
import { X } from 'lucide-react';

interface PacketDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  packet: any; // This will hold the detailed packet data from the backend
}

const PacketDetailModal: React.FC<PacketDetailModalProps> = ({ isOpen, onClose, packet }) => {
  if (!isOpen || !packet) return null;

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex justify-center items-center">
      <div className="relative p-8 bg-white w-full max-w-2xl mx-auto rounded-lg shadow-lg">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-2xl font-semibold text-gray-900">Packet Details (Packet #{packet.number})</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X size={24} />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto pr-4">
          {packet.layers && packet.layers.map((layer: any, index: number) => (
            <div key={index} className="mb-4 p-3 bg-gray-50 rounded-md border border-gray-200">
              <h4 className="text-lg font-medium text-gray-800 mb-2">{layer.name}</h4>
              <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                {Object.entries(layer.fields).map(([key, value]: [string, any]) => (
                  <li key={key}>
                    <span className="font-semibold">{key}:</span> {String(value)}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {!packet.layers && (
            <p className="text-gray-600">No detailed layer information available for this packet.</p>
          )}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-indigo-600 text-white text-base font-medium rounded-md shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default PacketDetailModal;
