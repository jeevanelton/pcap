import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { authFetch } from '../contexts/AuthContext';
import { 
  Download, 
  RefreshCw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Filter,
  Clock,
  Play,
  Pause,
  BarChart2
} from 'lucide-react';

interface FlowGraphProps {
  fileId: string | null;
}

interface PacketFlow {
  no: number;
  time: string;
  timestamp: number;
  src: string;
  dst: string;
  sport?: number;
  dport?: number;
  protocol: string;
  info: string;
  length: number;
}

const FlowGraph = ({ fileId }: FlowGraphProps) => {
  const [packets, setPackets] = useState<PacketFlow[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [protocolFilter, setProtocolFilter] = useState<string>('ALL');
  const [limit, setLimit] = useState(100);
  const [timeFormat, setTimeFormat] = useState<'absolute' | 'relative'>('relative');
  const canvasRef = useRef<HTMLDivElement>(null);
  const [selectedPacket, setSelectedPacket] = useState<PacketFlow | null>(null);
  const [isAnalyticsOpen, setAnalyticsOpen] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  
  // New feature states
  const [selectedHostPair, setSelectedHostPair] = useState<string | null>(null);
  const [visibleProtocols, setVisibleProtocols] = useState<Set<string>>(new Set(['ALL']));
  const [timeRangeStart, setTimeRangeStart] = useState<number | null>(null);
  const [timeRangeEnd, setTimeRangeEnd] = useState<number | null>(null);
  const [hoveredPacket, setHoveredPacket] = useState<PacketFlow | null>(null);
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');

  // Derived data & analytics
  const filteredPackets = useMemo(() => packets.filter(p => 
    protocolFilter === 'ALL' || p.protocol.toUpperCase() === protocolFilter
  ), [packets, protocolFilter]);

  const duration = useMemo(() => filteredPackets.length ? Math.max(...filteredPackets.map(p => p.timestamp)) : 0, [filteredPackets]);

  const analytics = useMemo(() => {
    if (!filteredPackets.length) return null;
    const totalPackets = filteredPackets.length;
    const totalBytes = filteredPackets.reduce((acc, p) => acc + (p.length || 0), 0);
    const protocolsCount: Record<string, number> = {};
    const hostPairCount: Record<string, number> = {};
    let prevTs: number | null = null;
    const deltas: number[] = [];
    filteredPackets.forEach(p => {
      const proto = p.protocol.toUpperCase();
      protocolsCount[proto] = (protocolsCount[proto] || 0) + 1;
      const key = `${p.src}→${p.dst}`;
      hostPairCount[key] = (hostPairCount[key] || 0) + 1;
      if (prevTs !== null) deltas.push(p.timestamp - prevTs);
      prevTs = p.timestamp;
    });
    const avgDelta = deltas.length ? deltas.reduce((a,b)=>a+b,0)/deltas.length : 0;
    const minDelta = deltas.length ? Math.min(...deltas) : 0;
    const maxDelta = deltas.length ? Math.max(...deltas) : 0;
    const pps = duration > 0 ? (totalPackets / duration) : totalPackets;
    const avgSize = totalPackets ? totalBytes / totalPackets : 0;
    // Sort helpers
    const topProtocols = Object.entries(protocolsCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
    const topPairs = Object.entries(hostPairCount).sort((a,b)=>b[1]-a[1]).slice(0,6);
    return { totalPackets, totalBytes, protocolsCount, hostPairCount, avgDelta, minDelta, maxDelta, pps, avgSize, topProtocols, topPairs };
  }, [filteredPackets, duration]);

  // Playback effect
  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    const tick = () => {
      setCurrentTime(prev => {
        const next = prev + 0.05 * playbackSpeed; // 50ms logical step scaled
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playbackSpeed, duration]);

  // Reset current time if data changes
  useEffect(() => {
    setCurrentTime(0);
    setSelectedPacket(null);
  }, [filteredPackets]);

  const fetchFlowData = async () => {
    if (!fileId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await authFetch(`http://localhost:8000/api/packets/${fileId}?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch packets');
      const data = await response.json();

      // Extract and transform packets
      const flowPackets: PacketFlow[] = data.packets.map((p: any, idx: number) => ({
        no: p.number || p.no || idx + 1,
        time: p.time || '',
        timestamp: p.time ? new Date(p.time).getTime() / 1000 : idx * 0.001,
        src: p.src_ip || p.src || 'Unknown',
        dst: p.dst_ip || p.dst || 'Unknown',
        sport: p.src_port || p.sport,
        dport: p.dst_port || p.dport,
        protocol: p.protocol || 'Unknown',
        info: p.info || '',
        length: p.length || 0,
      }));

      // Calculate relative timestamps
      if (flowPackets.length > 0) {
        const firstTime = flowPackets[0].timestamp;
        flowPackets.forEach(p => {
          p.timestamp = p.timestamp - firstTime;
        });
      }

      // Get unique hosts (sources and destinations)
      const uniqueHosts = new Set<string>();
      flowPackets.forEach(p => {
        uniqueHosts.add(p.src);
        uniqueHosts.add(p.dst);
      });
      const sortedHosts = Array.from(uniqueHosts).sort();

      setPackets(flowPackets);
      setHosts(sortedHosts);
    } catch (err) {
      console.error('Failed to fetch flow data:', err);
      setError('Failed to load flow graph');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFlowData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, limit]);

  // (Moved filteredPackets to useMemo above)

  const exportToPng = async () => {
    if (!canvasRef.current) return;
    try {
      const mod: any = await import('html-to-image');
      const dataUrl = await mod.toPng(canvasRef.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
      });
      const link = document.createElement('a');
      link.download = `flow-graph-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Ensure html-to-image is installed.');
    }
  };

  const resetZoom = useCallback(() => {
    setZoom(1);
    if (canvasRef.current) {
      canvasRef.current.scrollTop = 0;
      canvasRef.current.scrollLeft = 0;
    }
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 mb-4 animate-pulse">
            <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
          </div>
          <p className="text-gray-600 font-medium">Loading flow graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-red-50 rounded-2xl border border-red-100">
          <p className="text-red-600 font-medium">{error}</p>
          <button
            onClick={fetchFlowData}
            className="mt-4 inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (packets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-gray-500 font-medium">No packets to display</p>
        </div>
      </div>
    );
  }

  const hostWidth = 150;
  const rowHeight = 50;
  const leftMargin = 120;
  const topMargin = 80;
  const hostSpacing = 250;

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-50 to-blue-50">
      {/* Modern Controls Bar */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200/50 bg-white/80 backdrop-blur-md shadow-sm">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Protocol Filter */}
          <div className="flex items-center gap-2 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg px-3 py-2 border border-blue-200/50">
            <Filter className="h-4 w-4 text-blue-600" />
            <select
              value={protocolFilter}
              onChange={(e) => setProtocolFilter(e.target.value)}
              className="text-sm border-0 bg-transparent font-medium text-gray-700 focus:outline-none focus:ring-0 cursor-pointer"
            >
              <option value="ALL">All Protocols</option>
              <option value="TCP">TCP Flows</option>
              <option value="UDP">UDP Flows</option>
              <option value="ICMP">ICMP Flows</option>
              <option value="HTTP">HTTP</option>
              <option value="DNS">DNS</option>
              <option value="TLS">TLS</option>
            </select>
          </div>

          {/* Limit */}
          <div className="flex items-center gap-2 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg px-3 py-2 border border-purple-200/50">
            <span className="text-sm font-medium text-purple-700">Packets:</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-sm border-0 bg-transparent font-medium text-gray-700 focus:outline-none focus:ring-0 cursor-pointer"
            >
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
              <option value="500">500</option>
            </select>
          </div>

          {/* Time Format */}
          <div className="flex items-center gap-2 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg px-3 py-2 border border-green-200/50">
            <Clock className="h-4 w-4 text-green-600" />
            <select
              value={timeFormat}
              onChange={(e) => setTimeFormat(e.target.value as any)}
              className="text-sm border-0 bg-transparent font-medium text-gray-700 focus:outline-none focus:ring-0 cursor-pointer"
            >
              <option value="relative">Relative Time</option>
              <option value="absolute">Absolute Time</option>
            </select>
          </div>

          <div className="px-3 py-1.5 bg-gray-100 rounded-full">
            <span className="text-xs font-semibold text-gray-600">
              {filteredPackets.length} of {packets.length} packets
            </span>
          </div>
          {/* Timeline scrubber */}
          {duration > 0 && (
            <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-gray-200 shadow-sm">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.001}
                value={currentTime}
                onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
                className="w-40"
              />
              <div className="text-xs font-mono text-gray-600">
                {currentTime.toFixed(3)}s / {duration.toFixed(3)}s
              </div>
              <button
                onClick={() => setIsPlaying(p => !p)}
                className="p-1.5 rounded-md bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-sm"
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <select
                value={playbackSpeed}
                onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                className="text-xs border border-gray-300 rounded-md px-1.5 py-1 bg-white"
                title="Playback Speed"
              >
                {[0.25,0.5,1,2,4].map(s => <option key={s} value={s}>{s}x</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Zoom and Export Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-white rounded-lg shadow-sm border border-gray-200">
            <button
              onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
              className="p-2 hover:bg-gray-50 rounded-l-lg transition-colors border-r border-gray-200"
              title="Zoom Out"
            >
              <ZoomOut className="h-4 w-4 text-gray-600" />
            </button>
            <span className="px-3 text-sm font-medium text-gray-700 min-w-[60px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(Math.min(2, zoom + 0.25))}
              className="p-2 hover:bg-gray-50 transition-colors border-l border-gray-200"
              title="Zoom In"
            >
              <ZoomIn className="h-4 w-4 text-gray-600" />
            </button>
            <button
              onClick={resetZoom}
              className="p-2 hover:bg-gray-50 rounded-r-lg transition-colors border-l border-gray-200"
              title="Reset Zoom"
            >
              <Maximize2 className="h-4 w-4 text-gray-600" />
            </button>
          </div>
          <button
            onClick={exportToPng}
            className="p-2 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all shadow-md hover:shadow-lg flex items-center gap-2"
            title="Export as PNG"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm font-medium">Export</span>
          </button>
          <button
            onClick={() => setAnalyticsOpen(o => !o)}
            className="p-2 px-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm flex items-center gap-1"
            title="Toggle Analytics Panel"
          >
            <BarChart2 className="h-4 w-4 text-gray-600" />
            <span className="text-xs font-medium text-gray-700">Analytics</span>
          </button>
        </div>
      </div>

      {/* Flow Graph Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 overflow-auto bg-white"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
      >
        <div
          className="relative"
          style={{
            width: leftMargin + hosts.length * hostSpacing + 100,
            minHeight: topMargin + filteredPackets.length * rowHeight + 100,
          }}
        >
          {/* Host Headers */}
          <div className="sticky top-0 z-10 bg-gradient-to-r from-blue-50 to-indigo-50 border-b-2 border-indigo-200 shadow-sm">
            {hosts.map((host, idx) => (
              <div
                key={host}
                className="absolute text-center font-semibold text-sm"
                style={{
                  left: leftMargin + idx * hostSpacing,
                  top: 10,
                  width: hostWidth,
                }}
              >
                <div className="px-3 py-2 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-lg shadow-md border border-blue-400 hover:shadow-lg transition-shadow">
                  <div className="text-xs opacity-80 mb-0.5">Host</div>
                  <div className="font-bold">{host}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Vertical Host Lines */}
          {hosts.map((host, idx) => (
            <div
              key={`line-${host}`}
              className="absolute"
              style={{
                left: leftMargin + idx * hostSpacing + hostWidth / 2,
                top: topMargin,
                width: 2,
                height: filteredPackets.length * rowHeight,
                background: 'linear-gradient(to bottom, #e0e7ff, #ddd6fe)',
              }}
            />
          ))}

          {/* Packet Flows */}
          <svg
            className="absolute"
            style={{
              left: 0,
              top: topMargin,
              width: leftMargin + hosts.length * hostSpacing + 100,
              height: filteredPackets.length * rowHeight,
            }}
          >
            <defs>
              <marker
                id="arrowhead-blue"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#3b82f6" />
              </marker>
              <marker
                id="arrowhead-green"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#10b981" />
              </marker>
              <marker
                id="arrowhead-orange"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#f59e0b" />
              </marker>
              <marker
                id="arrowhead-purple"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#8b5cf6" />
              </marker>
              <marker
                id="arrowhead-pink"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#ec4899" />
              </marker>
              <marker
                id="arrowhead-gray"
                markerWidth="10"
                markerHeight="10"
                refX="9"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 10 3, 0 6" fill="#6b7280" />
              </marker>
            </defs>
            
            {filteredPackets.map((packet, idx) => {
              const srcIdx = hosts.indexOf(packet.src);
              const dstIdx = hosts.indexOf(packet.dst);
              const y = idx * rowHeight + rowHeight / 2;

              const x1 = leftMargin + srcIdx * hostSpacing + hostWidth / 2;
              const x2 = leftMargin + dstIdx * hostSpacing + hostWidth / 2;

              const isRightward = x2 > x1;
              
              const protocolColorMap: any = {
                'TCP': { color: '#3b82f6', marker: 'arrowhead-blue' },
                'UDP': { color: '#10b981', marker: 'arrowhead-green' },
                'ICMP': { color: '#f59e0b', marker: 'arrowhead-orange' },
                'HTTP': { color: '#8b5cf6', marker: 'arrowhead-purple' },
                'DNS': { color: '#ec4899', marker: 'arrowhead-pink' },
              };
              
              const colorInfo = protocolColorMap[packet.protocol] || { color: '#6b7280', marker: 'arrowhead-gray' };

              const isPast = packet.timestamp <= currentTime;
              const isSelected = selectedPacket?.no === packet.no;
              return (
                <g
                  key={packet.no}
                  onClick={() => setSelectedPacket(packet)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Arrow Line */}
                  <line
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={y}
                    stroke={colorInfo.color}
                    strokeWidth={isSelected ? 4 : 2.5}
                    strokeOpacity={isPast ? 0.9 : 0.2}
                    strokeDasharray={isPast ? '0' : '4 4'}
                    markerEnd={`url(#${colorInfo.marker})`}
                  />
                  {isSelected && (
                    <rect
                      x={Math.min(x1,x2)}
                      y={y-12}
                      width={Math.abs(x2-x1)}
                      height={24}
                      fill={colorInfo.color}
                      fillOpacity={0.08}
                      stroke={colorInfo.color}
                      strokeOpacity={0.4}
                      strokeDasharray="6 4"
                      rx={6}
                    />
                  )}
                  
                  {/* Port Labels */}
                  {packet.sport && (
                    <text
                      x={x1 + (isRightward ? 12 : -12)}
                      y={y - 6}
                      className="text-xs font-semibold fill-gray-700"
                      textAnchor={isRightward ? 'start' : 'end'}
                    >
                      :{packet.sport}
                    </text>
                  )}
                  {packet.dport && (
                    <text
                      x={x2 + (isRightward ? -12 : 12)}
                      y={y - 6}
                      className="text-xs font-semibold fill-gray-700"
                      textAnchor={isRightward ? 'end' : 'start'}
                    >
                      :{packet.dport}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Packet Info (Left Side) */}
          {filteredPackets.map((packet, idx) => (
            <div
              key={`info-${packet.no}`}
              className="absolute text-xs flex items-center gap-2 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm"
              style={{
                left: 5,
                top: topMargin + idx * rowHeight + rowHeight / 2 - 12,
                width: leftMargin - 10,
              }}
            >
              <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">
                #{packet.no}
              </span>
              <span className="font-mono text-blue-700 font-semibold">
                {timeFormat === 'relative' 
                  ? `${packet.timestamp.toFixed(3)}s`
                  : packet.time
                }
              </span>
              {selectedPacket?.no === packet.no && (
                <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200">SELECTED</span>
              )}
            </div>
          ))}

          {/* Protocol/Info Labels (Middle) */}
          {filteredPackets.map((packet, idx) => {
            const srcIdx = hosts.indexOf(packet.src);
            const dstIdx = hosts.indexOf(packet.dst);
            const x1 = leftMargin + srcIdx * hostSpacing + hostWidth / 2;
            const x2 = leftMargin + dstIdx * hostSpacing + hostWidth / 2;
            const midX = (x1 + x2) / 2;
            const y = topMargin + idx * rowHeight + rowHeight / 2 - 10;

            const protocolColor = 
              packet.protocol === 'TCP' ? 'bg-blue-100 text-blue-700 border-blue-300' :
              packet.protocol === 'UDP' ? 'bg-green-100 text-green-700 border-green-300' :
              packet.protocol === 'ICMP' ? 'bg-orange-100 text-orange-700 border-orange-300' :
              packet.protocol === 'HTTP' ? 'bg-purple-100 text-purple-700 border-purple-300' :
              packet.protocol === 'DNS' ? 'bg-pink-100 text-pink-700 border-pink-300' :
              'bg-gray-100 text-gray-700 border-gray-300';

            const isPast = packet.timestamp <= currentTime;
            return (
              <div
                key={`label-${packet.no}`}
                className={`absolute text-xs px-2.5 py-1 border rounded-lg shadow-md transition-all ${protocolColor} ${isPast ? 'opacity-100' : 'opacity-30'} ${selectedPacket?.no === packet.no ? 'ring-2 ring-purple-400 scale-[1.05]' : 'hover:shadow-lg'}`}
                style={{
                  left: midX - 60,
                  top: y + 8,
                  maxWidth: 140,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={packet.info}
                onClick={() => setSelectedPacket(packet)}
              >
                <span className="font-bold">{packet.protocol}</span>
                {packet.info && (
                  <span className="ml-1.5 opacity-80">
                    {packet.info.length > 18 ? packet.info.substring(0, 18) + '...' : packet.info}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Analytics & Details Side Panel */}
      {isAnalyticsOpen && (
        <div className="fixed right-4 top-40 bottom-4 w-80 bg-white/95 backdrop-blur-md border border-gray-300 rounded-xl shadow-2xl flex flex-col overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-gray-800">Analytics</h3>
            </div>
            <button
              onClick={() => setAnalyticsOpen(false)}
              className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 font-medium text-gray-700"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {!analytics && <p className="text-xs text-gray-500">No data</p>}
            {analytics && (
              <>
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
                      <div className="font-semibold text-blue-700">Packets</div>
                      <div className="font-mono text-xs">{analytics.totalPackets}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-200">
                      <div className="font-semibold text-indigo-700">Duration (s)</div>
                      <div className="font-mono text-xs">{duration.toFixed(3)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-green-50 border border-green-200">
                      <div className="font-semibold text-green-700">Total Bytes</div>
                      <div className="font-mono text-xs">{analytics.totalBytes}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-purple-50 border border-purple-200">
                      <div className="font-semibold text-purple-700">Avg Size</div>
                      <div className="font-mono text-xs">{analytics.avgSize.toFixed(1)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-orange-50 border border-orange-200">
                      <div className="font-semibold text-orange-700">Packets/sec</div>
                      <div className="font-mono text-xs">{analytics.pps.toFixed(2)}</div>
                    </div>
                    <div className="p-2 rounded-lg bg-pink-50 border border-pink-200">
                      <div className="font-semibold text-pink-700">Avg Delta (s)</div>
                      <div className="font-mono text-xs">{analytics.avgDelta.toFixed(3)}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="p-1.5 rounded bg-gray-50 border border-gray-200">
                      <span className="font-semibold">Min Δ</span>
                      <div className="font-mono">{analytics.minDelta.toFixed(3)}</div>
                    </div>
                    <div className="p-1.5 rounded bg-gray-50 border border-gray-200">
                      <span className="font-semibold">Max Δ</span>
                      <div className="font-mono">{analytics.maxDelta.toFixed(3)}</div>
                    </div>
                    <div className="p-1.5 rounded bg-gray-50 border border-gray-200">
                      <span className="font-semibold">Distinct Hosts</span>
                      <div className="font-mono">{hosts.length}</div>
                    </div>
                  </div>
                </div>
                {/* Protocol distribution */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 mb-2">Top Protocols</h4>
                  <div className="space-y-1">
                    {analytics.topProtocols.map(([proto,count]) => (
                      <div key={proto} className="flex items-center justify-between text-[11px] bg-white border border-gray-200 rounded px-2 py-1">
                        <span className="font-medium">{proto}</span>
                        <span className="font-mono text-gray-600">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Top host pairs */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 mb-2">Top Host Pairs</h4>
                  <div className="space-y-1">
                    {analytics.topPairs.map(([pair,count]) => (
                      <div key={pair} className="flex items-center justify-between text-[10px] bg-white border border-gray-200 rounded px-2 py-1">
                        <span className="truncate max-w-[150px]" title={pair}>{pair}</span>
                        <span className="font-mono text-gray-600">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {/* Selected packet details */}
                <div>
                  <h4 className="text-xs font-semibold text-gray-700 mb-2">Selected Packet</h4>
                  {!selectedPacket && <p className="text-[11px] text-gray-500">Click a flow arrow or label</p>}
                  {selectedPacket && (
                    <div className="text-[11px] space-y-1 bg-white border border-gray-200 rounded p-2">
                      <div className="flex justify-between"><span className="font-medium">#</span><span className="font-mono">{selectedPacket.no}</span></div>
                      <div className="flex justify-between"><span className="font-medium">Time</span><span className="font-mono">{selectedPacket.timestamp.toFixed(6)}s</span></div>
                      <div className="flex justify-between"><span className="font-medium">Src</span><span className="font-mono truncate max-w-[140px]" title={selectedPacket.src}>{selectedPacket.src}</span></div>
                      <div className="flex justify-between"><span className="font-medium">Dst</span><span className="font-mono truncate max-w-[140px]" title={selectedPacket.dst}>{selectedPacket.dst}</span></div>
                      {(selectedPacket.sport || selectedPacket.dport) && (
                        <div className="flex justify-between"><span className="font-medium">Ports</span><span className="font-mono">{selectedPacket.sport || '-'} → {selectedPacket.dport || '-'}</span></div>
                      )}
                      <div className="flex justify-between"><span className="font-medium">Protocol</span><span className="font-mono">{selectedPacket.protocol}</span></div>
                      <div className="flex justify-between"><span className="font-medium">Length</span><span className="font-mono">{selectedPacket.length} bytes</span></div>
                      {selectedPacket.info && (
                        <div className="text-[10px] bg-gray-50 rounded p-1 border border-gray-200" title={selectedPacket.info}>{selectedPacket.info}</div>
                      )}
                      <button
                        onClick={() => setSelectedPacket(null)}
                        className="mt-1 w-full text-center text-[11px] bg-gray-100 hover:bg-gray-200 rounded py-1"
                      >Clear Selection</button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FlowGraph;
