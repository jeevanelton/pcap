import type { ReactNode } from 'react';

interface Column<T> {
  header: string;
  accessor: keyof T;
  cell?: (value: any) => ReactNode;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  className?: string;
  onRowClick?: (row: T) => void; // New prop
}

export function DataTable<T extends object>({ data, columns, className = '', onRowClick }: DataTableProps<T>) {
  return (
    <div className={`overflow-x-auto shadow-md sm:rounded-lg ${className}`}>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-100">
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.accessor)}
                scope="col"
                className="px-6 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map((row, rowIndex) => (
            <tr 
              key={rowIndex} 
              className="hover:bg-gray-50 transition duration-150 ease-in-out cursor-pointer"
              onClick={() => onRowClick && onRowClick(row)}
            >
              {columns.map((column) => (
                <td key={String(column.accessor)}
                    className="px-6 py-4 whitespace-nowrap text-sm text-gray-800"
                >
                  {column.cell 
                    ? column.cell(row[column.accessor as keyof T])
                    : row[column.accessor] as ReactNode}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}