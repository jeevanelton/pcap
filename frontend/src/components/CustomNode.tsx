import React from 'react';
import { Handle, Position } from '@xyflow/react';

const CustomNode = ({ data }) => {
  return (
    <div className="px-4 py-2 shadow-md rounded-full bg-white border-2 border-blue-500">
      <div className="flex items-center justify-center text-lg font-semibold text-gray-800">
        {data.label}
      </div>
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-blue-400 rounded-full" />
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-blue-400 rounded-full" />
    </div>
  );
};

export default CustomNode;
