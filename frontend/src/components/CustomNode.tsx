import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Circle } from 'lucide-react';

interface CustomNodeData {
  label: string;
  connections?: number;
  hasQuery?: boolean;
  highlighted?: boolean;
  nodeType?: 'source' | 'target' | 'internal' | 'external';
}

type Props = { data: CustomNodeData };

const CustomNode = ({ data }: Props) => {
  const connections = data.connections || 0;
  const isDimmed = Boolean(data?.hasQuery) && !Boolean(data?.highlighted);
  
  // Determine node color based on type or connections
  const getNodeColor = () => {
    if (data?.highlighted) return 'from-yellow-400 to-orange-500';
    if (connections > 10) return 'from-red-400 to-pink-500';
    if (connections > 5) return 'from-orange-400 to-amber-500';
    return 'from-blue-400 to-cyan-500';
  };

  const getShadowColor = () => {
    if (data?.highlighted) return 'shadow-yellow-400/50';
    if (connections > 10) return 'shadow-red-400/50';
    if (connections > 5) return 'shadow-orange-400/50';
    return 'shadow-blue-400/50';
  };
  
  return (
    <div className={`group relative ${isDimmed ? 'opacity-30' : 'opacity-100'} transition-opacity duration-300`}>
      {/* Animated pulse ring */}
      {!isDimmed && (
        <div className={`absolute inset-0 bg-gradient-to-br ${getNodeColor()} rounded-full blur-xl opacity-60 group-hover:opacity-100 transition-opacity duration-300 animate-pulse`}></div>
      )}
      
      {/* Main node circle */}
      <div 
        className={`relative w-16 h-16 rounded-full bg-gradient-to-br ${getNodeColor()} shadow-xl ${getShadowColor()} flex items-center justify-center cursor-pointer transform transition-all duration-300 group-hover:scale-110 ${data?.highlighted ? 'ring-4 ring-yellow-300 ring-offset-2' : ''}`}
        title={`${data.label}\n${connections} connection${connections === 1 ? '' : 's'}`}
      >
        {/* Inner circle */}
        <div className="w-12 h-12 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center">
          <Circle className={`h-6 w-6 ${data?.highlighted ? 'text-yellow-600' : 'text-gray-700'} fill-current`} />
        </div>
        
        {/* Connection count badge */}
        {connections > 0 && (
          <div className="absolute -top-1 -right-1 bg-white rounded-full px-2 py-0.5 text-xs font-bold text-gray-800 shadow-lg border-2 border-white">
            {connections}
          </div>
        )}
      </div>
      
      {/* Label below node */}
      <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 whitespace-nowrap">
        <div className={`px-3 py-1 rounded-lg text-xs font-semibold ${data?.highlighted ? 'bg-yellow-100 text-yellow-900 border border-yellow-300' : 'bg-white text-gray-700 border border-gray-200'} shadow-md`}>
          {data.label}
        </div>
      </div>
      
      {/* Handles - invisible but functional */}
      <Handle 
        type="target" 
        position={Position.Top} 
        className="w-2 h-2 !bg-transparent !border-0"
      />
      <Handle 
        type="source" 
        position={Position.Bottom} 
        className="w-2 h-2 !bg-transparent !border-0"
      />
    </div>
  );
};

export default memo(CustomNode);
