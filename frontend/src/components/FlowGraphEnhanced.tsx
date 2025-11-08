import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { authFetch } from '../contexts/AuthContext';
import { 
  Download, 
  RefreshCw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Clock,
  Play,
  Pause,
  BarChart2,
  X,
  FileText,
  FileJson
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

const FlowGraphEnhanced = ({ fileId }: FlowGraphProps) => {
  const [packets, setPackets] = useState<PacketFlow[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [limit, setLimit] = useState(1000);
  const [totalPackets, setTotalPackets] = useState(0);
  const [loadedPackets, setLoadedPackets] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [timeFormat, setTimeFormat] = useState<'absolute' | 'relative'>('relative');
  const canvasRef = useRef<HTMLDivElement>(null);
  
  // Selection & interaction
  const [selectedPacket, setSelectedPacket] = useState<PacketFlow | null>(null);
  const [selectedHostPair, setSelectedHostPair] = useState<string | null>(null);
  const [hoveredPacket, setHoveredPacket] = useState<PacketFlow | null>(null);
  
  // UI panels
  const [isAnalyticsOpen, setAnalyticsOpen] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  
  // Timeline playback
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [timeRangeStart, setTimeRangeStart] = useState<number | null>(null);
  const [timeRangeEnd, setTimeRangeEnd] = useState<number | null>(null);
  
  // Protocol visibility
  const [visibleProtocols, setVisibleProtocols] = useState<Set<string>>(new Set());

  const fetchFlowData = async (appendMode = false) => {
    if (!fileId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const offset = appendMode ? packets.length : 0;
      const response = await authFetch(`http://localhost:8000/api/packets/${fileId}?limit=${limit}&offset=${offset}`);
      if (!response.ok) throw new Error('Failed to fetch packets');
      const data = await response.json();

      setTotalPackets(data.total_count || 0);
      setHasMore(data.has_more || false);

      const flowPackets: PacketFlow[] = data.packets.map((p: any, idx: number) => ({
        no: p.number || p.no || (offset + idx + 1),
        time: p.time || '',
        timestamp: p.time ? new Date(p.time).getTime() / 1000 : idx * 0.001,
        src: p.src_ip || p.src || 'Unknown',
        dst: p.dst_ip || p.dst || 'Unknown',
        sport: p.src_port || p.sport,
        dport: p.dst_port || p.dport,
        protocol: (p.protocol || 'Unknown').toUpperCase(),
        info: p.info || '',
        length: p.length || 0,
      }));

      let allPackets = appendMode ? [...packets, ...flowPackets] : flowPackets;

      if (allPackets.length > 0) {
        const firstTime = allPackets[0].timestamp;
        allPackets.forEach(p => {
          p.timestamp = p.timestamp - firstTime;
        });
      }

      const uniqueHosts = new Set<string>();
      allPackets.forEach(p => {
        uniqueHosts.add(p.src);
        uniqueHosts.add(p.dst);
      });
      const sortedHosts = Array.from(uniqueHosts).sort();

      setPackets(allPackets);
      setLoadedPackets(allPackets.length);
      setHosts(sortedHosts);
      
      // Initialize visible protocols
      const protocols = new Set(flowPackets.map(p => p.protocol));
      setVisibleProtocols(protocols);
    } catch (err) {
      console.error('Failed to fetch flow data:', err);
      setError('Failed to load flow graph');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchFlowData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  // Reload when limit changes
  useEffect(() => {
    if (fileId) {
      fetchFlowData(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  // Filtered packets based on all criteria
  const filteredPackets = useMemo(() => {
    let filtered = packets.filter(p => visibleProtocols.has(p.protocol));
    
    // Time range filter
    if (timeRangeStart !== null && timeRangeEnd !== null) {
      filtered = filtered.filter(p => p.timestamp >= timeRangeStart && p.timestamp <= timeRangeEnd);
    }
    
    // Host pair filter
    if (selectedHostPair) {
      const [src, dst] = selectedHostPair.split('→');
      filtered = filtered.filter(p => p.src === src && p.dst === dst);
    }
    
    return filtered;
  }, [packets, visibleProtocols, timeRangeStart, timeRangeEnd, selectedHostPair]);

  const duration = useMemo(() => 
    filteredPackets.length ? Math.max(...filteredPackets.map(p => p.timestamp)) : 0, 
    [filteredPackets]
  );

  // Comprehensive analytics
  const analytics = useMemo(() => {
    if (!filteredPackets.length) return null;
    
    const totalPackets = filteredPackets.length;
    const totalBytes = filteredPackets.reduce((acc, p) => acc + p.length, 0);
    const protocolsCount: Record<string, number> = {};
    const hostPairCount: Record<string, { count: number; bytes: number; ports: Set<number> }> = {};
    const portDistribution: Record<number, number> = {};
    
    let prevTs: number | null = null;
    const deltas: number[] = [];
    
    // TCP metrics
    const tcpPackets = filteredPackets.filter(p => p.protocol === 'TCP');
    const synPackets = tcpPackets.filter(p => p.info.includes('SYN'));
    const ackPackets = tcpPackets.filter(p => p.info.includes('ACK'));
    
    // DNS analytics
    const dnsPackets = filteredPackets.filter(p => p.protocol === 'DNS');
    const dnsQueries: Record<string, number> = {};
    
    filteredPackets.forEach(p => {
      const proto = p.protocol;
      protocolsCount[proto] = (protocolsCount[proto] || 0) + 1;
      
      const key = `${p.src}→${p.dst}`;
      if (!hostPairCount[key]) {
        hostPairCount[key] = { count: 0, bytes: 0, ports: new Set() };
      }
      hostPairCount[key].count++;
      hostPairCount[key].bytes += p.length;
      if (p.dport) hostPairCount[key].ports.add(p.dport);
      
      if (p.dport) portDistribution[p.dport] = (portDistribution[p.dport] || 0) + 1;
      
      if (prevTs !== null) deltas.push(p.timestamp - prevTs);
      prevTs = p.timestamp;
      
      // DNS query extraction (simplified)
      if (p.protocol === 'DNS' && p.info) {
        const match = p.info.match(/query|response/i);
        if (match) {
          dnsQueries[p.info] = (dnsQueries[p.info] || 0) + 1;
        }
      }
    });
    
    const avgDelta = deltas.length ? deltas.reduce((a,b)=>a+b,0)/deltas.length : 0;
    const minDelta = deltas.length ? Math.min(...deltas) : 0;
    const maxDelta = deltas.length ? Math.max(...deltas) : 0;
    const pps = duration > 0 ? (totalPackets / duration) : totalPackets;
    const avgSize = totalPackets ? totalBytes / totalPackets : 0;
    
    const topProtocols = Object.entries(protocolsCount).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const topPairs = Object.entries(hostPairCount)
      .map(([pair, data]) => ({ pair, ...data, ports: Array.from(data.ports) }))
      .sort((a,b)=>b.count-a.count)
      .slice(0,10);
    const topPorts = Object.entries(portDistribution).sort((a,b)=>b[1]-a[1]).slice(0,10);
    const topDNS = Object.entries(dnsQueries).sort((a,b)=>b[1]-a[1]).slice(0,10);
    
    return { 
      totalPackets, totalBytes, protocolsCount, avgDelta, minDelta, maxDelta, pps, avgSize, 
      topProtocols, topPairs, topPorts, topDNS,
      tcpSynCount: synPackets.length,
      tcpAckCount: ackPackets.length,
      dnsCount: dnsPackets.length
    };
  }, [filteredPackets, duration]);

  // Playback
  useEffect(() => {
    if (!isPlaying) return;
    let raf: number;
    const tick = () => {
      setCurrentTime(prev => {
        const next = prev + 0.05 * playbackSpeed;
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

  useEffect(() => {
    setCurrentTime(0);
    setSelectedPacket(null);
    setSelectedHostPair(null);
    setTimeRangeStart(null);
    setTimeRangeEnd(null);
  }, [filteredPackets]);

  const exportData = useCallback((format: 'csv' | 'json') => {
    if (!filteredPackets.length) return;
    
    let content = '';
    let filename = '';
    
    if (format === 'csv') {
      const headers = ['No', 'Time', 'Src', 'Src Port', 'Dst', 'Dst Port', 'Protocol', 'Length', 'Info'];
      const rows = filteredPackets.map(p => [
        p.no, p.timestamp.toFixed(6), p.src, p.sport || '', p.dst, p.dport || '', p.protocol, p.length, `"${p.info}"`
      ]);
      content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      filename = `flow-graph-${Date.now()}.csv`;
    } else {
      const exportData = {
        metadata: {
          totalPackets: filteredPackets.length,
          duration,
          exportedAt: new Date().toISOString()
        },
        analytics,
        packets: filteredPackets
      };
      content = JSON.stringify(exportData, null, 2);
      filename = `flow-graph-${Date.now()}.json`;
    }
    
    const blob = new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }, [filteredPackets, duration, analytics]);

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
    }
  };

  const resetZoom = useCallback(() => {
    setZoom(1);
    if (canvasRef.current) {
      canvasRef.current.scrollTop = 0;
      canvasRef.current.scrollLeft = 0;
    }
  }, []);

  const toggleProtocol = useCallback((protocol: string) => {
    setVisibleProtocols(prev => {
      const next = new Set(prev);
      if (next.has(protocol)) {
        next.delete(protocol);
      } else {
        next.add(protocol);
      }
      return next;
    });
  }, []);

  const handleTimeRangeSelection = useCallback((start: number, end: number) => {
    setTimeRangeStart(Math.min(start, end));
    setTimeRangeEnd(Math.max(start, end));
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
            onClick={() => fetchFlowData(false)}
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

  const protocolColorMap: Record<string, { color: string; marker: string }> = {
    'TCP': { color: '#3b82f6', marker: 'arrowhead-blue' },
    'UDP': { color: '#10b981', marker: 'arrowhead-green' },
    'ICMP': { color: '#f59e0b', marker: 'arrowhead-orange' },
    'HTTP': { color: '#8b5cf6', marker: 'arrowhead-purple' },
    'DNS': { color: '#ec4899', marker: 'arrowhead-pink' },
    'TLS': { color: '#14b8a6', marker: 'arrowhead-teal' },
    'QUIC': { color: '#f43f5e', marker: 'arrowhead-rose' },
  };

  return (
    <div className="h-full flex flex-col bg-gradient-to-br from-gray-50 to-blue-50 relative">
      {/* Controls Bar */}
      <div className="flex items-center justify-between p-3 border-b border-gray-200/50 bg-white/80 backdrop-blur-md shadow-sm flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Packet Limit */}
          <div className="flex items-center gap-1 bg-gradient-to-r from-purple-50 to-pink-50 rounded-lg px-2 py-1.5 border border-purple-200/50">
            <span className="text-xs font-medium text-purple-700">Load:</span>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="text-xs border-0 bg-transparent font-medium text-gray-700 focus:outline-none cursor-pointer"
            >
              {[500,1000,2000,3000,5000].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          {/* Packet Count Display */}
          <div className="px-2 py-1 bg-gradient-to-r from-indigo-50 to-blue-50 rounded-lg border border-indigo-200/50">
            <span className="text-xs font-semibold text-indigo-700">
              {loadedPackets.toLocaleString()} / {totalPackets.toLocaleString()} packets loaded
            </span>
          </div>

          {/* Load More Button */}
          {hasMore && (
            <button
              onClick={() => fetchFlowData(true)}
              disabled={isLoading}
              className="text-xs px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Loading...
                </>
              ) : (
                <>Load More</>
              )}
            </button>
          )}

          {/* Time Format */}
          <div className="flex items-center gap-1 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg px-2 py-1.5 border border-green-200/50">
            <Clock className="h-3 w-3 text-green-600" />
            <select
              value={timeFormat}
              onChange={(e) => setTimeFormat(e.target.value as any)}
              className="text-xs border-0 bg-transparent font-medium text-gray-700 focus:outline-none cursor-pointer"
            >
              <option value="relative">Relative</option>
              <option value="absolute">Absolute</option>
            </select>
          </div>

          {(timeRangeStart !== null && timeRangeEnd !== null) && (
            <button
              onClick={() => { setTimeRangeStart(null); setTimeRangeEnd(null); }}
              className="text-xs px-2 py-1 bg-orange-100 text-orange-700 rounded-md hover:bg-orange-200"
            >
              Clear Range
            </button>
          )}
          
          {selectedHostPair && (
            <button
              onClick={() => setSelectedHostPair(null)}
              className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-md hover:bg-blue-200"
            >
              Clear Pair: {selectedHostPair.split('→')[0].substring(0,10)}...
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-white rounded-lg shadow-sm border border-gray-200">
            <button onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} className="p-1.5 hover:bg-gray-50 rounded-l-lg" title="Zoom Out">
              <ZoomOut className="h-3 w-3 text-gray-600" />
            </button>
            <span className="px-2 text-xs font-medium text-gray-700">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(Math.min(2, zoom + 0.25))} className="p-1.5 hover:bg-gray-50" title="Zoom In">
              <ZoomIn className="h-3 w-3 text-gray-600" />
            </button>
            <button onClick={resetZoom} className="p-1.5 hover:bg-gray-50 rounded-r-lg border-l border-gray-200" title="Reset">
              <Maximize2 className="h-3 w-3 text-gray-600" />
            </button>
          </div>
          
          {/* Export */}
          <div className="flex items-center gap-1">
            <button onClick={exportToPng} className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm" title="Export PNG">
              <Download className="h-3 w-3" />
            </button>
            <button onClick={() => exportData('csv')} className="p-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm" title="Export CSV">
              <FileText className="h-3 w-3" />
            </button>
            <button onClick={() => exportData('json')} className="p-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 shadow-sm" title="Export JSON">
              <FileJson className="h-3 w-3" />
            </button>
          </div>
          
          <button
            onClick={() => setShowLegend(s => !s)}
            className="text-xs px-2 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm"
          >
            Legend
          </button>
          
          <button
            onClick={() => setAnalyticsOpen(o => !o)}
            className="text-xs px-2 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shadow-sm flex items-center gap-1"
          >
            <BarChart2 className="h-3 w-3" />
            Analytics
          </button>
        </div>
      </div>

      {/* Timeline Playback */}
      {duration > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
          <button
            onClick={() => setIsPlaying(p => !p)}
            className="p-2 rounded-md bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 shadow-md"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>
          
          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.001}
              value={currentTime}
              onChange={(e) => setCurrentTime(parseFloat(e.target.value))}
              onMouseUp={(e) => {
                if (e.shiftKey && timeRangeStart === null) {
                  setTimeRangeStart(currentTime);
                } else if (e.shiftKey && timeRangeStart !== null) {
                  handleTimeRangeSelection(timeRangeStart, currentTime);
                }
              }}
              className="flex-1 h-2 rounded-lg appearance-none bg-gradient-to-r from-blue-200 to-indigo-300 cursor-pointer"
              style={{
                background: timeRangeStart !== null && timeRangeEnd !== null
                  ? `linear-gradient(to right, #ddd ${(timeRangeStart/duration)*100}%, #3b82f6 ${(timeRangeStart/duration)*100}%, #3b82f6 ${(timeRangeEnd/duration)*100}%, #ddd ${(timeRangeEnd/duration)*100}%)`
                  : undefined
              }}
            />
            <div className="text-xs font-mono text-gray-700 min-w-[140px]">
              {currentTime.toFixed(3)}s / {duration.toFixed(3)}s
            </div>
          </div>
          
          <select
            value={playbackSpeed}
            onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
            className="text-xs border border-gray-300 rounded-md px-2 py-1 bg-white"
          >
            {[0.25,0.5,1,2,4,8].map(s => <option key={s} value={s}>{s}x</option>)}
          </select>
          
          <span className="text-[10px] text-gray-500">Shift+Click to select range</span>
        </div>
      )}

      {/* Protocol Legend */}
      {showLegend && (
        <div className="absolute top-32 left-4 bg-white/95 backdrop-blur-sm border border-gray-300 rounded-lg shadow-xl p-3 z-40 max-w-xs">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-800">Protocol Legend</h4>
            <button onClick={() => setShowLegend(false)} className="text-gray-500 hover:text-gray-700">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(protocolColorMap).map(([proto, { color }]) => {
              const isVisible = visibleProtocols.has(proto);
              return (
                <button
                  key={proto}
                  onClick={() => toggleProtocol(proto)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-all ${
                    isVisible ? 'bg-white border-2' : 'bg-gray-100 opacity-50 border-2 border-transparent'
                  }`}
                  style={{ borderColor: isVisible ? color : 'transparent' }}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                  <span>{proto}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Flow Graph Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 overflow-auto bg-white"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        onMouseMove={(e) => {
          const tooltip = document.getElementById('flow-tooltip');
          if (tooltip && hoveredPacket) {
            tooltip.style.display = 'block';
            tooltip.style.left = `${e.clientX + 15}px`;
            tooltip.style.top = `${e.clientY - 10}px`;
          }
        }}
        onMouseLeave={() => {
          const tooltip = document.getElementById('flow-tooltip');
          if (tooltip) tooltip.style.display = 'none';
        }}
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
                className="absolute text-center font-semibold text-sm cursor-pointer hover:scale-105 transition-transform"
                style={{
                  left: leftMargin + idx * hostSpacing,
                  top: 10,
                  width: hostWidth,
                }}
                onClick={() => {
                  // Show all pairs with this host
                  const pairs = Array.from(new Set(
                    filteredPackets.filter(p => p.src === host || p.dst === host)
                      .map(p => `${p.src}→${p.dst}`)
                  ));
                  console.log('Host pairs:', pairs);
                }}
              >
                <div className="px-3 py-2 bg-gradient-to-br from-blue-500 to-indigo-600 text-white rounded-lg shadow-md border border-blue-400 hover:shadow-lg transition-shadow">
                  <div className="text-[10px] opacity-80 mb-0.5">Host</div>
                  <div className="font-bold text-xs">{host}</div>
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

          {/* Packet Flows SVG */}
          <svg
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: topMargin,
              width: leftMargin + hosts.length * hostSpacing + 100,
              height: filteredPackets.length * rowHeight,
            }}
          >
            <defs>
              {Object.entries(protocolColorMap).map(([proto, { color }]) => (
                <marker
                  key={`marker-${proto}`}
                  id={`arrowhead-${proto.toLowerCase()}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                >
                  <polygon points="0 0, 10 3, 0 6" fill={color} />
                </marker>
              ))}
            </defs>
            
            {filteredPackets.map((packet, idx) => {
              const srcIdx = hosts.indexOf(packet.src);
              const dstIdx = hosts.indexOf(packet.dst);
              const y = idx * rowHeight + rowHeight / 2;
              const x1 = leftMargin + srcIdx * hostSpacing + hostWidth / 2;
              const x2 = leftMargin + dstIdx * hostSpacing + hostWidth / 2;
              const isRightward = x2 > x1;
              const colorInfo = protocolColorMap[packet.protocol] || { color: '#6b7280', marker: 'arrowhead-gray' };
              const isPast = packet.timestamp <= currentTime;
              const isSelected = selectedPacket?.no === packet.no;
              const isHovered = hoveredPacket?.no === packet.no;

              return (
                <g key={packet.no} className="pointer-events-auto cursor-pointer">
                  <line
                    x1={x1}
                    y1={y}
                    x2={x2}
                    y2={y}
                    stroke={colorInfo.color}
                    strokeWidth={isSelected ? 4 : isHovered ? 3 : 2.5}
                    strokeOpacity={isPast ? 0.9 : 0.2}
                    strokeDasharray={isPast ? '0' : '4 4'}
                    markerEnd={`url(#${colorInfo.marker})`}
                    onClick={() => setSelectedPacket(packet)}
                    onMouseEnter={() => setHoveredPacket(packet)}
                    onMouseLeave={() => setHoveredPacket(null)}
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
                  
                  {packet.sport && (
                    <text x={x1 + (isRightward ? 12 : -12)} y={y - 6} className="text-[10px] font-semibold fill-gray-700" textAnchor={isRightward ? 'start' : 'end'}>
                      :{packet.sport}
                    </text>
                  )}
                  {packet.dport && (
                    <text x={x2 + (isRightward ? -12 : 12)} y={y - 6} className="text-[10px] font-semibold fill-gray-700" textAnchor={isRightward ? 'end' : 'start'}>
                      :{packet.dport}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Hover Tooltip - Follows Mouse */}
          {hoveredPacket && (
            <div
              id="flow-tooltip"
              className="fixed z-50 bg-gray-900 text-white text-[11px] px-3 py-2 rounded-lg shadow-2xl pointer-events-none"
              style={{ display: 'none' }}
            >
              <div className="font-semibold mb-1">{hoveredPacket.protocol}</div>
              <div className="space-y-0.5 text-gray-300">
                <div>{hoveredPacket.timestamp.toFixed(6)}s</div>
                <div>{hoveredPacket.src}:{hoveredPacket.sport || '-'} → {hoveredPacket.dst}:{hoveredPacket.dport || '-'}</div>
                <div>{hoveredPacket.length} bytes</div>
              </div>
            </div>
          )}

          {/* Packet Info (Left Side) */}
          {filteredPackets.map((packet, idx) => (
            <div
              key={`info-${packet.no}`}
              className="absolute text-[11px] flex items-center gap-1.5 bg-white/80 backdrop-blur-sm rounded-lg px-2 py-1 shadow-sm"
              style={{
                left: 5,
                top: topMargin + idx * rowHeight + rowHeight / 2 - 12,
                width: leftMargin - 10,
              }}
            >
              <span className="font-mono font-bold text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded text-[10px]">
                #{packet.no}
              </span>
              <span className="font-mono text-blue-700 font-semibold text-[10px]">
                {packet.timestamp.toFixed(3)}s
              </span>
              {selectedPacket?.no === packet.no && (
                <span className="text-[9px] font-semibold text-purple-600 bg-purple-50 px-1 py-0.5 rounded border border-purple-200">SEL</span>
              )}
            </div>
          ))}

          {/* Protocol Labels (Middle) */}
          {filteredPackets.map((packet, idx) => {
            const srcIdx = hosts.indexOf(packet.src);
            const dstIdx = hosts.indexOf(packet.dst);
            const x1 = leftMargin + srcIdx * hostSpacing + hostWidth / 2;
            const x2 = leftMargin + dstIdx * hostSpacing + hostWidth / 2;
            const midX = (x1 + x2) / 2;
            const y = topMargin + idx * rowHeight + rowHeight / 2 - 10;
            const colorMap: Record<string, string> = {
              'TCP': 'bg-blue-100 text-blue-700 border-blue-300',
              'UDP': 'bg-green-100 text-green-700 border-green-300',
              'ICMP': 'bg-orange-100 text-orange-700 border-orange-300',
              'HTTP': 'bg-purple-100 text-purple-700 border-purple-300',
              'DNS': 'bg-pink-100 text-pink-700 border-pink-300',
              'TLS': 'bg-teal-100 text-teal-700 border-teal-300',
              'QUIC': 'bg-rose-100 text-rose-700 border-rose-300',
              'DATA': 'bg-violet-100 text-violet-700 border-violet-300',
            };
            const protocolColor = colorMap[packet.protocol] || 'bg-gray-100 text-gray-700 border-gray-300';
            const isPast = packet.timestamp <= currentTime;
            const isSelected = selectedPacket?.no === packet.no;

            return (
              <div
                key={`label-${packet.no}`}
                className={`absolute text-[11px] px-2 py-1 border rounded-lg shadow-md transition-all cursor-pointer ${protocolColor} ${
                  isPast ? 'opacity-100' : 'opacity-30'
                } ${isSelected ? 'ring-2 ring-purple-400 scale-[1.05]' : 'hover:shadow-lg'}`}
                style={{
                  left: midX - 60,
                  top: y + 8,
                  maxWidth: 120,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={packet.info}
                onClick={() => setSelectedPacket(packet)}
              >
                <span className="font-bold">{packet.protocol}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Analytics Panel */}
      {isAnalyticsOpen && analytics && (
        <div className="fixed right-4 top-32 bottom-4 w-80 bg-white/95 backdrop-blur-md border border-gray-300 rounded-xl shadow-2xl flex flex-col overflow-hidden z-50">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
            <div className="flex items-center gap-2">
              <BarChart2 className="h-4 w-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-gray-800">Analytics</h3>
            </div>
            <button onClick={() => setAnalyticsOpen(false)} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 font-medium">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
                <div className="font-semibold text-blue-700">Loaded</div>
                <div className="font-mono text-xs">{loadedPackets}</div>
              </div>
              <div className="p-2 rounded-lg bg-purple-50 border border-purple-200">
                <div className="font-semibold text-purple-700">Total</div>
                <div className="font-mono text-xs">{totalPackets}</div>
              </div>
              <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-200">
                <div className="font-semibold text-indigo-700">Duration</div>
                <div className="font-mono text-xs">{duration.toFixed(3)}s</div>
              </div>
              <div className="p-2 rounded-lg bg-green-50 border border-green-200">
                <div className="font-semibold text-green-700">Bytes</div>
                <div className="font-mono text-xs">{analytics.totalBytes}</div>
              </div>
              <div className="p-2 rounded-lg bg-orange-50 border border-orange-200">
                <div className="font-semibold text-orange-700">Avg Size</div>
                <div className="font-mono text-xs">{analytics.avgSize.toFixed(1)}</div>
              </div>
              <div className="p-2 rounded-lg bg-pink-50 border border-pink-200">
                <div className="font-semibold text-pink-700">PPS</div>
                <div className="font-mono text-xs">{analytics.pps.toFixed(2)}</div>
              </div>
            </div>

            {/* TCP Metrics */}
            {analytics.tcpSynCount > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">TCP Handshakes</h4>
                <div className="text-[11px] bg-white border border-gray-200 rounded p-2 space-y-1">
                  <div className="flex justify-between">
                    <span>SYN Packets:</span>
                    <span className="font-mono">{analytics.tcpSynCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>ACK Packets:</span>
                    <span className="font-mono">{analytics.tcpAckCount}</span>
                  </div>
                </div>
              </div>
            )}

            {/* DNS Analytics */}
            {analytics.dnsCount > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">DNS Activity</h4>
                <div className="text-[11px] bg-white border border-gray-200 rounded p-2">
                  <div className="flex justify-between">
                    <span>DNS Packets:</span>
                    <span className="font-mono">{analytics.dnsCount}</span>
                  </div>
                </div>
                {analytics.topDNS.length > 0 && (
                  <div className="mt-1 space-y-1">
                    {analytics.topDNS.slice(0, 3).map(([query, count]) => (
                      <div key={query} className="text-[10px] bg-pink-50 border border-pink-200 rounded px-2 py-1 flex justify-between">
                        <span className="truncate max-w-[180px]" title={query}>{query}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Top Protocols */}
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">Top Protocols</h4>
              <div className="space-y-1">
                {analytics.topProtocols.map(([proto, count]) => (
                  <div key={proto} className="flex items-center justify-between text-[11px] bg-white border border-gray-200 rounded px-2 py-1">
                    <span className="font-medium">{proto}</span>
                    <span className="font-mono text-gray-600">{count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Host Pairs */}
            <div>
              <h4 className="text-xs font-semibold text-gray-700 mb-1">Top Connections</h4>
              <div className="space-y-1">
                {analytics.topPairs.map(({ pair, count, bytes, ports }) => {
                  const isActive = selectedHostPair === pair;
                  return (
                    <div
                      key={pair}
                      className={`text-[10px] border rounded px-2 py-1.5 hover:bg-blue-50 cursor-pointer transition-colors ${
                        isActive ? 'bg-blue-100 border-blue-400' : 'bg-white border-gray-200'
                      }`}
                      onClick={() => {
                        if (isActive) {
                          setSelectedHostPair(null);
                        } else {
                          setSelectedHostPair(pair);
                        }
                      }}
                    >
                      <div className="flex justify-between mb-0.5">
                        <span className="truncate max-w-[180px] font-medium" title={pair}>{pair}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                      <div className="flex justify-between text-gray-600">
                        <span>{bytes} bytes</span>
                        <span>Ports: {ports.slice(0,3).join(', ')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Top Ports */}
            {analytics.topPorts.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">Top Ports</h4>
                <div className="grid grid-cols-2 gap-1">
                  {analytics.topPorts.map(([port, count]) => (
                    <div key={port} className="text-[10px] bg-white border border-gray-200 rounded px-2 py-1 flex justify-between">
                      <span className="font-mono">{port}</span>
                      <span className="text-gray-600">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Selected Packet */}
            {selectedPacket && (
              <div>
                <h4 className="text-xs font-semibold text-gray-700 mb-1">Selected Packet</h4>
                <div className="text-[11px] space-y-1 bg-white border border-purple-300 rounded p-2">
                  <div className="flex justify-between"><span className="font-medium">#</span><span className="font-mono">{selectedPacket.no}</span></div>
                  <div className="flex justify-between"><span className="font-medium">Time</span><span className="font-mono">{selectedPacket.timestamp.toFixed(6)}s</span></div>
                  <div className="flex justify-between"><span className="font-medium">Src</span><span className="font-mono truncate max-w-[140px]">{selectedPacket.src}</span></div>
                  <div className="flex justify-between"><span className="font-medium">Dst</span><span className="font-mono truncate max-w-[140px]">{selectedPacket.dst}</span></div>
                  <div className="flex justify-between"><span className="font-medium">Ports</span><span className="font-mono">{selectedPacket.sport || '-'} → {selectedPacket.dport || '-'}</span></div>
                  <div className="flex justify-between"><span className="font-medium">Protocol</span><span className="font-mono">{selectedPacket.protocol}</span></div>
                  <div className="flex justify-between"><span className="font-medium">Length</span><span className="font-mono">{selectedPacket.length} bytes</span></div>
                  {selectedPacket.info && (
                    <div className="text-[10px] bg-gray-50 rounded p-1 border border-gray-200 mt-1">{selectedPacket.info}</div>
                  )}
                  <button
                    onClick={() => setSelectedPacket(null)}
                    className="mt-2 w-full text-center text-[11px] bg-gray-100 hover:bg-gray-200 rounded py-1"
                  >
                    Clear Selection
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default FlowGraphEnhanced;
