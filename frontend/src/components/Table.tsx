interface Column<T> {
  header: string;
  accessor: keyof T;
  cell?: (value: any) => React.ReactNode;
}

interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  className?: string;
}

export function Table<T extends object>({ 
  data, 
  columns, 
  className = '' 
}: TableProps<T>) {
  return (
    <div className={`overflow-x-auto -mx-6 ${className}`}>
      <table className="min-w-full divide-y divide-slate-700">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={String(column.accessor)}
                className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {data.map((row, rowIndex) => (
            <tr 
              key={rowIndex}
              className="hover:bg-slate-700/50 transition-colors"
            >
              {columns.map((column) => (
                <td
                  key={String(column.accessor)}
                  className="px-6 py-4 whitespace-nowrap text-sm text-slate-300"
                >
                  {column.cell 
                    ? column.cell(row[column.accessor])
                    : String(row[column.accessor])
                  }
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}