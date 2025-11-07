import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

const CustomEdge = memo(({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
  style,
}: any) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  // Determine edge color based on activity or data
  const getEdgeColor = () => {
    if (data?.highlighted) return '#fbbf24'; // yellow
    if (data?.packets > 100) return '#ef4444'; // red
    if (data?.packets > 50) return '#f97316'; // orange
    return '#3b82f6'; // blue
  };

  const edgeColor = getEdgeColor();
  const opacity = data?.dimmed ? 0.15 : 0.6;
  const packets = Number(data?.packets || 0);
  const bytes = Number(data?.bytes || 0);
  const weight = packets || Math.round(bytes / 1024);
  const strokeWidth = 1.5 + Math.min(3, Math.log10((weight || 0) + 1));
  const particleCount = Math.min(5, Math.max(1, Math.round((packets || 1) / 50)));

  return (
    <>
      {/* Main edge path with gradient */}
      <BaseEdge 
        id={id} 
        path={edgePath} 
        markerEnd={markerEnd}
        style={{
          strokeWidth,
          stroke: edgeColor,
          opacity: opacity,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          filter: data?.dimmed ? 'none' : 'drop-shadow(0 0 2px rgba(59, 130, 246, 0.4))',
          ...style
        }}
      />
      
      {/* Particle highlights moving along the edge (lightweight SVG animation) */}
      {!data?.dimmed && (
        <g>
          {Array.from({ length: particleCount }).map((_, i) => (
            <path
              key={i}
              d={edgePath}
              stroke="#ffffff"
              strokeWidth={Math.max(1, strokeWidth * 0.35)}
              strokeLinecap="round"
              fill="none"
              strokeDasharray="1 120"
              opacity={0.9}
              style={{ filter: 'drop-shadow(0 0 2px rgba(255,255,255,0.7))' }}
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-120" dur="2s" begin={`${i * 0.3}s`} repeatCount="indefinite" />
            </path>
          ))}
        </g>
      )}

      {/* Edge label with timestamp/info */}
      <EdgeLabelRenderer>
        {data?.label && !data?.dimmed && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            <div className="px-2 py-1 rounded text-[10px] font-medium bg-white/90 backdrop-blur-sm text-gray-700 shadow-md border border-gray-200">
              {data.label}
            </div>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

CustomEdge.displayName = 'CustomEdge';

export default CustomEdge;
