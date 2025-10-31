import { useState } from 'react';
import { ArrowDownUp } from 'lucide-react';

// Helper to format bytes
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

// UI: Rewritten IpTables.tsx for the new light theme with sorting and additional metrics.
const IpTable = ({ title, initialData }) => {
  const [data, setData] = useState(initialData);
  const [sortColumn, setSortColumn] = useState('packets');
  const [sortDirection, setSortDirection] = useState('desc'); // 'asc' or 'desc'

  const handleSort = (column) => {
    const isAsc = sortColumn === column && sortDirection === 'asc';
    setSortDirection(isAsc ? 'desc' : 'asc');
    setSortColumn(column);

    const sortedData = [...data].sort((a, b) => {
      let valA, valB;
      if (column === 'ip') {
        valA = a.ip;
        valB = b.ip;
      } else if (column === 'packets') {
        valA = a.packets;
        valB = b.packets;
      } else if (column === 'bytes') {
        valA = a.bytes;
        valB = b.bytes;
      } else if (column === 'percentage') {
        valA = parseFloat(a.percentage);
        valB = parseFloat(b.percentage);
      }

      if (valA < valB) return isAsc ? -1 : 1;
      if (valA > valB) return isAsc ? 1 : -1;
      return 0;
    });
    setData(sortedData);
  };

  const getSortIcon = (column) => {
    if (sortColumn === column) {
      return sortDirection === 'asc' ? ' ↑' : ' ↓';
    }
    return '';
  };

  return (
    <div>
      <h4 className="text-md font-semibold text-gray-800 mb-3">{title}</h4>
      <div className="flow-root">
        <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
            <table className="min-w-full divide-y divide-gray-300">
              <thead>
                <tr>
                  <th 
                    scope="col" 
                    className="cursor-pointer py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-0"
                    onClick={() => handleSort('ip')}
                  >
                    IP Address {getSortIcon('ip')}
                  </th>
                  <th 
                    scope="col" 
                    className="cursor-pointer px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                    onClick={() => handleSort('packets')}
                  >
                    Packets {getSortIcon('packets')}
                  </th>
                  <th 
                    scope="col" 
                    className="cursor-pointer px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                    onClick={() => handleSort('bytes')}
                  >
                    Bytes {getSortIcon('bytes')}
                  </th>
                  <th 
                    scope="col" 
                    className="cursor-pointer px-3 py-3.5 text-left text-sm font-semibold text-gray-900"
                    onClick={() => handleSort('percentage')}
                  >
                    % {getSortIcon('percentage')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {data.map((item, idx) => (
                  <tr key={idx}>
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-0">{item.ip}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{item.packets}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{formatBytes(item.bytes)}</td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">{item.percentage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export function IpTables({ analysisData }) {
  if (!analysisData) return null;

  return (
    <div className="space-y-8">
      <IpTable title="Top Source IPs" initialData={analysisData.top_sources} />
      <IpTable title="Top Destination IPs" initialData={analysisData.top_destinations} />
    </div>
  );
}
