import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  ChevronRight, 
  ChevronDown, 
  X,
  Copy,
  Download,
  Filter as FilterIcon,
  Info as InfoIcon,
  RefreshCw,
  Layers,
  Search,
  ArrowUpDown,
  GitMerge,
  ChevronUp,
  Eye,
  EyeOff
} from 'lucide-react';
import { authFetch } from '../contexts/AuthContext';
import { API_BASE_URL } from '../config';

const API_BASE = API_BASE_URL;

interface Packet {
  number: number;
  time: string;
  src_ip?: string;
  dst_ip?: string;
  src_port?: number;
  dst_port?: number;
  protocol: string;
  length: number;
  info?: string;
}

interface PacketDetail {
  number: number;
  time: string;
  src_ip: string;
  dst_ip: string;
  src_port: number;
  dst_port: number;
  protocol: string;
  length: number;
  info: string;
  layers: any[];
}

interface WiresharkViewerProps {
  fileId: string;
  packetsData: { 
    packets: Packet[]; 
    total_count?: number;
    returned_count?: number;
    has_more?: boolean;
  };
  totalPacketsFromOverview?: number;
}

const WiresharkViewer: React.FC<WiresharkViewerProps> = ({ fileId, packetsData, totalPacketsFromOverview }) => {
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);
  const [packetDetail, setPacketDetail] = useState<PacketDetail | null>(null);
  const [expandedLayers, setExpandedLayers] = useState<Set<string>>(new Set());
  const [displayFilter, setDisplayFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markedPackets, setMarkedPackets] = useState<Set<number>>(new Set());
  const [timeFormat, setTimeFormat] = useState<'absolute' | 'relative' | 'delta'>('relative');
  const [allPackets, setAllPackets] = useState<Packet[]>(packetsData?.packets || []);
  const [totalCount, setTotalCount] = useState(
    packetsData?.total_count || totalPacketsFromOverview || 0
  );
  const [hasMore, setHasMore] = useState(packetsData?.has_more || false);
  const [offset, setOffset] = useState(packetsData?.packets?.length || 0);
  
  // New feature states
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; packet: Packet } | null>(null);
  
  // Follow Stream states (prepared for future modal implementation)
  // const [followStreamPacket, setFollowStreamPacket] = useState<Packet | null>(null);
  // const [showFollowStream, setShowFollowStream] = useState(false);
  // const [streamData, setStreamData] = useState<any>(null);
  
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const isLoadingRef = useRef(false);

  // Update ref when loading state changes
  useEffect(() => {
    isLoadingRef.current = loadingMore;
  }, [loadingMore]);

  // Load more packets when scrolling
  const loadMorePackets = useCallback(async () => {
    if (isLoadingRef.current || !hasMore) {
      console.log('Load more blocked:', { loading: isLoadingRef.current, hasMore });
      return;
    }
    
    isLoadingRef.current = true;
    setLoadingMore(true);
    console.log('Loading more packets from offset:', offset);
    
    try {
      const response = await authFetch(
        `${API_BASE}/api/packets/${fileId}?limit=2000&offset=${offset}`
      );
      if (!response.ok) throw new Error('Failed to load more packets');
      
      const data = await response.json();
      console.log('Loaded packets:', data.packets.length, 'Total:', data.total_count);
      
      setAllPackets(prev => [...prev, ...data.packets]);
      setOffset(prev => prev + data.packets.length);
      setHasMore(data.has_more || false);
      setTotalCount(data.total_count || 0);
    } catch (error) {
      console.error('Failed to load more packets:', error);
    } finally {
      setLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [fileId, offset, hasMore]);

  // Infinite scroll handler - improved version
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
    
    // Load more when scrolled past 80%
    if (scrollPercentage > 0.8 && !isLoadingRef.current && hasMore) {
      console.log('Triggering load more - scroll %:', (scrollPercentage * 100).toFixed(1));
      loadMorePackets();
    }
  }, [hasMore, loadMorePackets]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Add event listener with passive: false for better performance
    container.addEventListener('scroll', handleScroll, { passive: true });
    
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [handleScroll]);

  // Update packets when data changes
  useEffect(() => {
    if (packetsData?.packets) {
      setAllPackets(packetsData.packets);
      setOffset(packetsData.packets.length);
      setHasMore(packetsData.has_more || false);
      setTotalCount(packetsData.total_count || totalPacketsFromOverview || 0);
    }
  }, [packetsData, totalPacketsFromOverview]);

  // Time calculations with memoization
  const packetsWithTime = useMemo(() => {
    if (!allPackets.length) return [];
    
    const firstTime = new Date(allPackets[0].time).getTime();
    return allPackets.map((packet, idx) => {
      const currentTime = new Date(packet.time).getTime();
      const relativeTime = ((currentTime - firstTime) / 1000).toFixed(6);
      const deltaTime = idx > 0 
        ? ((currentTime - new Date(allPackets[idx - 1].time).getTime()) / 1000).toFixed(6)
        : '0.000000';
      
      const absoluteTime = new Date(packet.time).toLocaleTimeString('en-US', { 
        hour12: false, 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        fractionalSecondDigits: 3
      } as any);

      return {
        ...packet,
        relativeTime,
        deltaTime,
        absoluteTime,
        displayTime: timeFormat === 'absolute' ? absoluteTime
          : timeFormat === 'relative' ? relativeTime : deltaTime
      };
    });
  }, [allPackets, timeFormat]);

  // Advanced filtering with proper Wireshark syntax
  const filteredPackets = useMemo(() => {
    if (!appliedFilter) return packetsWithTime;
    
    return packetsWithTime.filter(packet => {
      const filter = appliedFilter.toLowerCase().trim();
      
      // IP address filters
      if (filter.match(/ip\.addr\s*==\s*(.+)/)) {
        const ip = filter.match(/ip\.addr\s*==\s*(.+)/)?.[1]?.trim();
        return packet.src_ip === ip || packet.dst_ip === ip;
      }
      if (filter.match(/ip\.src\s*==\s*(.+)/)) {
        const ip = filter.match(/ip\.src\s*==\s*(.+)/)?.[1]?.trim();
        return packet.src_ip === ip;
      }
      if (filter.match(/ip\.dst\s*==\s*(.+)/)) {
        const ip = filter.match(/ip\.dst\s*==\s*(.+)/)?.[1]?.trim();
        return packet.dst_ip === ip;
      }
      
      // Port filters
      if (filter.match(/tcp\.port\s*==\s*(\d+)/)) {
        const port = parseInt(filter.match(/tcp\.port\s*==\s*(\d+)/)?.[1] || '0');
        return packet.protocol.toLowerCase().includes('tcp') && 
               (packet.src_port === port || packet.dst_port === port);
      }
      if (filter.match(/udp\.port\s*==\s*(\d+)/)) {
        const port = parseInt(filter.match(/udp\.port\s*==\s*(\d+)/)?.[1] || '0');
        return packet.protocol.toLowerCase().includes('udp') && 
               (packet.src_port === port || packet.dst_port === port);
      }
      
      // Protocol filters with OR/AND
      if (filter.includes('||')) {
        return filter.split('||').some(f => 
          packet.protocol.toLowerCase().includes(f.trim())
        );
      }
      if (filter.includes('&&')) {
        return filter.split('&&').every(f => 
          packet.protocol.toLowerCase().includes(f.trim())
        );
      }
      
      // Simple protocol match
      return packet.protocol.toLowerCase().includes(filter) || 
             packet.info?.toLowerCase().includes(filter) ||
             packet.src_ip?.includes(filter) ||
             packet.dst_ip?.includes(filter);
    });
  }, [packetsWithTime, appliedFilter]);

  const applyFilter = () => setAppliedFilter(displayFilter);
  const clearFilter = () => {
    setDisplayFilter('');
    setAppliedFilter('');
  };

  // Fetch packet details
  const fetchPacketDetail = async (packet: Packet) => {
    setLoading(true);
    try {
      const response = await authFetch(`${API_BASE}/api/packet/${fileId}/${packet.number}`);
      if (!response.ok) throw new Error('Failed to fetch packet details');
      const data = await response.json();
      setPacketDetail(data);
      setExpandedLayers(new Set(['layer_0']));
    } catch (error) {
      console.error('Failed to fetch packet details:', error);
      setPacketDetail(null);
    } finally {
      setLoading(false);
    }
  };

  const handlePacketClick = (packet: Packet) => {
    setSelectedPacket(packet);
    fetchPacketDetail(packet);
  };

  const toggleLayer = (layerKey: string) => {
    const newExpanded = new Set(expandedLayers);
    if (newExpanded.has(layerKey)) {
      newExpanded.delete(layerKey);
    } else {
      newExpanded.add(layerKey);
    }
    setExpandedLayers(newExpanded);
  };

  const toggleMark = (packetNum: number) => {
    const newMarked = new Set(markedPackets);
    if (newMarked.has(packetNum)) {
      newMarked.delete(packetNum);
    } else {
      newMarked.add(packetNum);
    }
    setMarkedPackets(newMarked);
  };

  // === NEW FEATURES ===
  
  // 1. Packet Search & Find
  const handleSearch = (term: string) => {
    if (!term.trim()) {
      setSearchResults([]);
      setCurrentSearchIndex(0);
      return;
    }

    const results: number[] = [];
    const searchLower = term.toLowerCase();
    
    filteredPackets.forEach((packet, index) => {
      const searchableText = [
        packet.number.toString(),
        packet.src_ip,
        packet.dst_ip,
        packet.protocol,
        packet.info,
        packet.src_port?.toString(),
        packet.dst_port?.toString()
      ].filter(Boolean).join(' ').toLowerCase();
      
      if (searchableText.includes(searchLower)) {
        results.push(index);
      }
    });
    
    setSearchResults(results);
    setCurrentSearchIndex(0);
    
    // Scroll to first result
    if (results.length > 0 && scrollContainerRef.current) {
      const firstResult = filteredPackets[results[0]];
      handlePacketClick(firstResult);
    }
  };

  const navigateSearch = (direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return;
    
    let newIndex = currentSearchIndex;
    if (direction === 'next') {
      newIndex = (currentSearchIndex + 1) % searchResults.length;
    } else {
      newIndex = currentSearchIndex === 0 ? searchResults.length - 1 : currentSearchIndex - 1;
    }
    
    setCurrentSearchIndex(newIndex);
    const packet = filteredPackets[searchResults[newIndex]];
    handlePacketClick(packet);
  };

  // 2. Column Sorting
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const sortedPackets = useMemo(() => {
    if (!sortColumn) return filteredPackets;
    
    return [...filteredPackets].sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortColumn) {
        case 'number':
          aVal = a.number;
          bVal = b.number;
          break;
        case 'time':
          aVal = new Date(a.time).getTime();
          bVal = new Date(b.time).getTime();
          break;
        case 'source':
          aVal = `${a.src_ip}:${a.src_port || ''}`;
          bVal = `${b.src_ip}:${b.src_port || ''}`;
          break;
        case 'destination':
          aVal = `${a.dst_ip}:${a.dst_port || ''}`;
          bVal = `${b.dst_ip}:${b.dst_port || ''}`;
          break;
        case 'protocol':
          aVal = a.protocol;
          bVal = b.protocol;
          break;
        case 'length':
          aVal = a.length;
          bVal = b.length;
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredPackets, sortColumn, sortDirection]);

  // 3. Follow Stream
  const followStream = async (packet: Packet, protocol: 'tcp' | 'udp') => {
    if (!packet.src_ip || !packet.dst_ip) return;
    
    // setFollowStreamPacket(packet);  // TODO: Uncomment when implementing Follow Stream modal
    setLoading(true);
    
    try {
      // Filter packets that are part of this stream
      const streamPackets = allPackets.filter(p => 
        (p.src_ip === packet.src_ip && p.dst_ip === packet.dst_ip && 
         p.src_port === packet.src_port && p.dst_port === packet.dst_port) ||
        (p.src_ip === packet.dst_ip && p.dst_ip === packet.src_ip && 
         p.src_port === packet.dst_port && p.dst_port === packet.src_port)
      );
      
      // setStreamData({  // TODO: Uncomment when implementing Follow Stream modal
      //   protocol,
      //   packets: streamPackets,
      //   srcIp: packet.src_ip,
      //   dstIp: packet.dst_ip,
      //   srcPort: packet.src_port,
      //   dstPort: packet.dst_port
      // });
      // setShowFollowStream(true);  // TODO: Uncomment when implementing Follow Stream modal
      
      // For now, just apply a filter to show the stream
      const filter = `(ip.addr==${packet.src_ip} && ip.addr==${packet.dst_ip} && ${protocol}.port==${packet.src_port} && ${protocol}.port==${packet.dst_port})`;
      setDisplayFilter(filter);
      setAppliedFilter(filter);
      console.log(`Following ${protocol.toUpperCase()} stream: ${streamPackets.length} packets`);
    } catch (error) {
      console.error('Failed to follow stream:', error);
    } finally {
      setLoading(false);
    }
  };

  // 4. Quick Filter Menu (Right-click actions)
  const applyQuickFilter = (type: string, packet: Packet) => {
    let filter = '';
    
    switch (type) {
      case 'conversation':
        filter = `(ip.addr==${packet.src_ip} && ip.addr==${packet.dst_ip})`;
        break;
      case 'src_ip':
        filter = `ip.src==${packet.src_ip}`;
        break;
      case 'dst_ip':
        filter = `ip.dst==${packet.dst_ip}`;
        break;
      case 'protocol':
        filter = packet.protocol.toLowerCase();
        break;
      case 'src_port':
        if (packet.src_port) {
          filter = `${packet.protocol.toLowerCase()}.port==${packet.src_port}`;
        }
        break;
      case 'dst_port':
        if (packet.dst_port) {
          filter = `${packet.protocol.toLowerCase()}.port==${packet.dst_port}`;
        }
        break;
    }
    
    if (filter) {
      setDisplayFilter(filter);
      setAppliedFilter(filter);
    }
    setContextMenu(null);
  };

  // 5. Keyboard Shortcuts
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      // Ctrl/Cmd + F - Search
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        document.getElementById('packet-search-input')?.focus();
      }
      
      // Ctrl/Cmd + G - Next search result
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        e.preventDefault();
        navigateSearch(e.shiftKey ? 'prev' : 'next');
      }
      
      // Ctrl/Cmd + M - Mark packet
      if ((e.ctrlKey || e.metaKey) && e.key === 'm' && selectedPacket) {
        e.preventDefault();
        toggleMark(selectedPacket.number);
      }
      
      // Ctrl/Cmd + → - Follow stream
      if ((e.ctrlKey || e.metaKey) && e.key === 'ArrowRight' && selectedPacket) {
        e.preventDefault();
        const proto = selectedPacket.protocol.toLowerCase();
        if (proto === 'tcp' || proto === 'udp') {
          followStream(selectedPacket, proto as 'tcp' | 'udp');
        }
      }
      
      // Arrow Up/Down - Navigate packets
      if (e.key === 'ArrowDown' && selectedPacket) {
        e.preventDefault();
        const currentIndex = sortedPackets.findIndex(p => p.number === selectedPacket.number);
        if (currentIndex < sortedPackets.length - 1) {
          handlePacketClick(sortedPackets[currentIndex + 1]);
        }
      }
      if (e.key === 'ArrowUp' && selectedPacket) {
        e.preventDefault();
        const currentIndex = sortedPackets.findIndex(p => p.number === selectedPacket.number);
        if (currentIndex > 0) {
          handlePacketClick(sortedPackets[currentIndex - 1]);
        }
      }
      
      // Escape - Clear selection/close modals
      if (e.key === 'Escape') {
        // setShowFollowStream(false);  // TODO: Uncomment when implementing Follow Stream modal
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [selectedPacket, sortedPackets, searchResults, currentSearchIndex]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  // === END NEW FEATURES ===

  // Render protocol tree
  const renderProtocolTree = (
    key: string, 
    value: any, 
    level: number = 0, 
    parentKey: string = ''
  ): React.ReactNode => {
    const uniqueKey = `${parentKey}_${key}`;
    const isExpanded = expandedLayers.has(uniqueKey);
    const isObject = typeof value === 'object' && value !== null && !Array.isArray(value);

    return (
      <div key={uniqueKey} className="font-mono text-xs">
        <div
          className="flex items-start py-0.5 px-2 hover:bg-blue-50 cursor-pointer"
          style={{ paddingLeft: `${level * 20 + 8}px` }}
          onClick={() => isObject && toggleLayer(uniqueKey)}
        >
          <span className="w-3 mr-2 flex-shrink-0 text-gray-500">
            {isObject && (isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
          </span>
          <span className="break-all">
            {!isObject ? (
              <>
                <span className="text-blue-700 font-medium">{key}</span>
                <span className="text-gray-600">: </span>
                <span className="text-red-700">{String(value)}</span>
              </>
            ) : (
              <span className="text-blue-800 font-semibold">{key}</span>
            )}
          </span>
        </div>
        {isObject && isExpanded && (
          <div>
            {Object.entries(value).map(([k, v]) => 
              renderProtocolTree(k, v, level + 1, uniqueKey)
            )}
          </div>
        )}
      </div>
    );
  };

  // Get packet row color
  const getPacketColor = (protocol: string) => {
    const proto = protocol.toLowerCase();
    if (proto === 'tcp') return 'bg-blue-50';
    if (proto === 'udp') return 'bg-cyan-50';
    if (proto === 'dns') return 'bg-sky-100';
    if (proto === 'http' || proto === 'https') return 'bg-green-50';
    if (proto === 'tls' || proto === 'ssl') return 'bg-purple-50';
    if (proto === 'arp') return 'bg-red-50';
    if (proto === 'icmp') return 'bg-orange-50';
    return 'bg-white';
  };

  // Export packets
  const exportPackets = (format: 'csv' | 'json') => {
    const exportData = filteredPackets;
    let content = '';
    
    if (format === 'csv') {
      content = '"No.","Time","Source","Destination","Protocol","Length","Info"\n';
      exportData.forEach(p => {
        const src = p.src_ip + (p.src_port ? `:${p.src_port}` : '');
        const dst = p.dst_ip + (p.dst_port ? `:${p.dst_port}` : '');
        content += `"${p.number}","${p.displayTime}","${src}","${dst}","${p.protocol}","${p.length}","${(p.info || '').replace(/"/g, '""')}"\n`;
      });
    } else {
      content = JSON.stringify(exportData, null, 2);
    }
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `packets_${fileId}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Toolbar */}
      <div className="bg-white border-b border-gray-300 shadow-sm">
        {/* Filter Row */}
        <div className="flex items-center gap-2 px-3 py-2">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Filter:</label>
          <input
            type="text"
            value={displayFilter}
            onChange={(e) => setDisplayFilter(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && applyFilter()}
            placeholder="tcp.port==80 || dns || ip.addr==192.168.1.1"
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          <button
            onClick={applyFilter}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-md transition-colors"
          >
            Apply
          </button>
          {appliedFilter && (
            <button
              onClick={clearFilter}
              className="px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded-md transition-colors"
              title="Clear filter"
            >
              <X size={16} />
            </button>
          )}
          <div className="border-l border-gray-300 h-8 mx-2" />
          <select
            value={timeFormat}
            onChange={(e) => setTimeFormat(e.target.value as any)}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500"
          >
            <option value="relative">Relative Time</option>
            <option value="absolute">Absolute Time</option>
            <option value="delta">Delta Time</option>
          </select>
          <button
            onClick={() => exportPackets('csv')}
            className="p-1.5 hover:bg-gray-100 rounded-md transition-colors"
            title="Export as CSV"
          >
            <Download size={18} />
          </button>
        </div>

        {/* Search Row */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-gray-200 bg-gray-50">
          <label className="text-sm font-medium text-gray-700 whitespace-nowrap flex items-center gap-1">
            <Search size={16} />
            Search:
          </label>
          <input
            id="packet-search-input"
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              handleSearch(e.target.value);
            }}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                navigateSearch(e.shiftKey ? 'prev' : 'next');
              }
            }}
            placeholder="Search packets... (Ctrl+F)"
            className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {searchResults.length > 0 && (
            <>
              <span className="text-xs text-gray-600">
                {currentSearchIndex + 1} / {searchResults.length}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => navigateSearch('prev')}
                  className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                  title="Previous (Ctrl+Shift+G)"
                >
                  <ChevronUp size={16} />
                </button>
                <button
                  onClick={() => navigateSearch('next')}
                  className="p-1.5 hover:bg-gray-200 rounded transition-colors"
                  title="Next (Ctrl+G)"
                >
                  <ChevronDown size={16} />
                </button>
              </div>
            </>
          )}
          {searchTerm && (
            <button
              onClick={() => {
                setSearchTerm('');
                setSearchResults([]);
              }}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors"
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {appliedFilter && (
          <div className="px-3 py-1.5 bg-yellow-50 border-t border-yellow-200 flex items-center gap-2 text-sm">
            <FilterIcon size={14} className="text-yellow-700" />
            <span className="font-medium text-yellow-800">Filter:</span>
            <span className="font-mono text-yellow-900">{appliedFilter}</span>
            <span className="ml-auto text-gray-600">
              Showing {filteredPackets.length.toLocaleString()} of {totalCount.toLocaleString()} packets
            </span>
          </div>
        )}
      </div>

      {/* Main Content - Split view */}
      <div className="flex-1 flex overflow-hidden">
        {/* Packet List - 60% */}
        <div className="w-[60%] flex flex-col border-r border-gray-300 bg-white">
          <div 
            ref={scrollContainerRef}
            className="flex-1 overflow-auto"
            style={{ scrollBehavior: 'smooth' }}
          >
            <table className="w-full border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-gray-100 border-b-2 border-gray-400">
                <tr>
                  <th 
                    onClick={() => handleSort('number')}
                    className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-300 w-16 cursor-pointer hover:bg-gray-200"
                  >
                    <div className="flex items-center gap-1">
                      No.
                      {sortColumn === 'number' && <ArrowUpDown size={12} />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('time')}
                    className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-300 w-32 cursor-pointer hover:bg-gray-200"
                  >
                    <div className="flex items-center gap-1">
                      Time
                      {sortColumn === 'time' && <ArrowUpDown size={12} />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('source')}
                    className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-300 cursor-pointer hover:bg-gray-200"
                  >
                    <div className="flex items-center gap-1">
                      Source
                      {sortColumn === 'source' && <ArrowUpDown size={12} />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('destination')}
                    className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-300 cursor-pointer hover:bg-gray-200"
                  >
                    <div className="flex items-center gap-1">
                      Destination
                      {sortColumn === 'destination' && <ArrowUpDown size={12} />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('protocol')}
                    className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-300 w-20 cursor-pointer hover:bg-gray-200"
                  >
                    <div className="flex items-center gap-1">
                      Protocol
                      {sortColumn === 'protocol' && <ArrowUpDown size={12} />}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('length')}
                    className="px-3 py-2 text-left font-semibold text-gray-700 border-r border-gray-300 w-20 cursor-pointer hover:bg-gray-200"
                  >
                    <div className="flex items-center gap-1">
                      Length
                      {sortColumn === 'length' && <ArrowUpDown size={12} />}
                    </div>
                  </th>
                  <th className="px-3 py-2 text-left font-semibold text-gray-700">Info</th>
                </tr>
              </thead>
              <tbody ref={tableBodyRef} className="font-mono">
                {sortedPackets.map((packet, idx) => {
                  const isSelected = selectedPacket?.number === packet.number;
                  const isMarked = markedPackets.has(packet.number);
                  const isSearchResult = searchResults.includes(idx);
                  const bgColor = isMarked ? 'bg-black text-white' : 
                                 isSearchResult ? 'bg-yellow-100' :
                                 getPacketColor(packet.protocol);
                  
                  return (
                    <tr
                      key={packet.number}
                      onClick={() => handlePacketClick(packet)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ x: e.clientX, y: e.clientY, packet });
                      }}
                      className={`border-b border-gray-200 cursor-pointer transition-colors ${bgColor} ${
                        isSelected ? 'ring-2 ring-inset ring-blue-500' : 'hover:bg-blue-100'
                      }`}
                    >
                      <td className="px-3 py-1.5 border-r border-gray-200 text-right">{packet.number}</td>
                      <td className="px-3 py-1.5 border-r border-gray-200">{packet.displayTime}</td>
                      <td className="px-3 py-1.5 border-r border-gray-200">
                        {packet.src_ip || '-'}
                        {packet.src_port ? <span className="text-gray-500">:{packet.src_port}</span> : ''}
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-200">
                        {packet.dst_ip || '-'}
                        {packet.dst_port ? <span className="text-gray-500">:{packet.dst_port}</span> : ''}
                      </td>
                      <td className="px-3 py-1.5 border-r border-gray-200 font-semibold">{packet.protocol}</td>
                      <td className="px-3 py-1.5 border-r border-gray-200 text-right">{packet.length}</td>
                      <td className="px-3 py-1.5 truncate max-w-md">{packet.info || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Loading indicator */}
            {loadingMore && (
              <div className="py-8 text-center bg-blue-50 border-t border-blue-200">
                <RefreshCw className="animate-spin inline-block text-blue-500 mb-2" size={24} />
                <p className="text-sm text-gray-600 font-medium">Loading more packets...</p>
                <p className="text-xs text-gray-500 mt-1">
                  Loading {allPackets.length.toLocaleString()} - {Math.min(allPackets.length + 2000, totalCount).toLocaleString()} of {totalCount.toLocaleString()}
                </p>
              </div>
            )}

            {/* Empty state */}
            {filteredPackets.length === 0 && !loadingMore && (
              <div className="py-16 text-center">
                <InfoIcon size={48} className="mx-auto mb-3 text-gray-300" />
                <p className="text-gray-500">No packets to display</p>
                {appliedFilter && <p className="text-sm text-gray-400 mt-1">Try adjusting your filter</p>}
              </div>
            )}
          </div>

          {/* Packet list status bar */}
          <div className="border-t border-gray-300 px-3 py-1.5 bg-gray-50 text-xs text-gray-600 flex items-center justify-between">
            <span>
              {filteredPackets.length === allPackets.length 
                ? `${allPackets.length.toLocaleString()} packets` 
                : `${filteredPackets.length.toLocaleString()} / ${allPackets.length.toLocaleString()} packets`}
              {allPackets.length < totalCount && (
                <span className="ml-2 text-blue-600 font-medium">
                  ({totalCount.toLocaleString()} total)
                </span>
              )}
            </span>
            <div className="flex items-center gap-2">
              {markedPackets.size > 0 && <span className="text-blue-600 font-medium">{markedPackets.size} marked</span>}
              {hasMore && (
                <button
                  onClick={loadMorePackets}
                  disabled={loadingMore}
                  className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loadingMore ? 'Loading...' : `Load More (${(totalCount - allPackets.length).toLocaleString()} remaining)`}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Details Panel - 40% */}
        <div className="w-[40%] flex flex-col bg-white">
          {/* Packet Details */}
          <div className="h-1/2 flex flex-col border-b border-gray-300">
            <div className="bg-gray-100 border-b border-gray-300 px-3 py-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Layers size={16} />
                Packet Details
              </span>
              {packetDetail && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const allLayers = packetDetail.layers.map((_, i) => `layer_${i}`);
                      setExpandedLayers(new Set(allLayers));
                    }}
                    className="text-xs px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded transition-colors"
                  >
                    Expand All
                  </button>
                  <button
                    onClick={() => setExpandedLayers(new Set())}
                    className="text-xs px-2 py-1 bg-gray-500 hover:bg-gray-600 text-white rounded transition-colors"
                  >
                    Collapse All
                  </button>
                  <button
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(packetDetail, null, 2))}
                    className="p-1 hover:bg-gray-200 rounded transition-colors"
                    title="Copy as JSON"
                  >
                    <Copy size={16} />
                  </button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-auto bg-white">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <RefreshCw className="animate-spin text-blue-500" size={24} />
                </div>
              ) : packetDetail ? (
                <div className="py-2">
                  {packetDetail.layers?.map((layer: any, idx: number) => (
                    <div key={idx}>
                      {renderProtocolTree(
                        layer.name || `Layer ${idx}`, 
                        layer.fields || layer, 
                        0, 
                        `layer_${idx}`
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <Layers size={40} className="mb-2 opacity-50" />
                  <p className="text-sm">Select a packet to view details</p>
                </div>
              )}
            </div>
          </div>

          {/* Packet Summary */}
          <div className="h-1/2 flex flex-col">
            <div className="bg-gray-100 border-b border-gray-300 px-3 py-2">
              <span className="text-sm font-semibold text-gray-700">Packet Summary</span>
            </div>
            <div className="flex-1 overflow-auto p-3 bg-gray-50">
              {selectedPacket ? (
                <div className="space-y-2 text-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="font-medium text-gray-600">Packet Number:</div>
                    <div className="font-mono">{selectedPacket.number}</div>
                    
                    <div className="font-medium text-gray-600">Protocol:</div>
                    <div className="font-mono font-semibold">{selectedPacket.protocol}</div>
                    
                    <div className="font-medium text-gray-600">Length:</div>
                    <div className="font-mono">{selectedPacket.length} bytes</div>
                    
                    <div className="font-medium text-gray-600">Time:</div>
                    <div className="font-mono text-xs">{selectedPacket.time}</div>
                    
                    {selectedPacket.src_ip && (
                      <>
                        <div className="font-medium text-gray-600">Source:</div>
                        <div className="font-mono">
                          {selectedPacket.src_ip}
                          {selectedPacket.src_port && `:${selectedPacket.src_port}`}
                        </div>
                      </>
                    )}
                    
                    {selectedPacket.dst_ip && (
                      <>
                        <div className="font-medium text-gray-600">Destination:</div>
                        <div className="font-mono">
                          {selectedPacket.dst_ip}
                          {selectedPacket.dst_port && `:${selectedPacket.dst_port}`}
                        </div>
                      </>
                    )}
                  </div>
                  
                  {selectedPacket.info && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="font-medium text-gray-600 mb-1">Info:</div>
                      <div className="text-xs font-mono bg-white p-2 rounded border border-gray-200">
                        {selectedPacket.info}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <p className="text-sm">No packet selected</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
          }}
          className="bg-white border border-gray-300 rounded-md shadow-lg py-1 min-w-[200px] text-sm"
        >
          <button
            onClick={() => {
              followStream(contextMenu.packet, 'tcp');
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100 flex items-center gap-2"
          >
            <GitMerge size={14} />
            Follow TCP Stream
          </button>
          <button
            onClick={() => {
              followStream(contextMenu.packet, 'udp');
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100 flex items-center gap-2"
          >
            <GitMerge size={14} />
            Follow UDP Stream
          </button>
          <div className="border-t border-gray-200 my-1" />
          <div className="px-4 py-1 text-xs font-semibold text-gray-500">Apply as Filter</div>
          <button
            onClick={() => {
              applyQuickFilter('conversation', contextMenu.packet);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100"
          >
            Conversation (both ways)
          </button>
          <button
            onClick={() => {
              applyQuickFilter('src_ip', contextMenu.packet);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100"
          >
            Source IP
          </button>
          <button
            onClick={() => {
              applyQuickFilter('dst_ip', contextMenu.packet);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100"
          >
            Destination IP
          </button>
          <button
            onClick={() => {
              applyQuickFilter('protocol', contextMenu.packet);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100"
          >
            Protocol
          </button>
          <button
            onClick={() => {
              applyQuickFilter('src_port', contextMenu.packet);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100"
          >
            Source Port
          </button>
          <button
            onClick={() => {
              applyQuickFilter('dst_port', contextMenu.packet);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100"
          >
            Destination Port
          </button>
          <div className="border-t border-gray-200 my-1" />
          <button
            onClick={() => {
              toggleMark(contextMenu.packet.number);
              setContextMenu(null);
            }}
            className="w-full text-left px-4 py-2 hover:bg-blue-100 flex items-center gap-2"
          >
            {markedPackets.has(contextMenu.packet.number) ? (
              <>
                <EyeOff size={14} />
                Unmark Packet
              </>
            ) : (
              <>
                <Eye size={14} />
                Mark Packet
              </>
            )}
          </button>
        </div>
      )}

      {/* Status Bar */}
      <div className="bg-gray-100 border-t border-gray-300 px-3 py-1 flex items-center justify-between text-xs text-gray-700">
        <div className="flex items-center gap-4">
          <span>Total: <strong>{totalCount.toLocaleString()}</strong> packets</span>
          <span>Loaded: <strong>{allPackets.length.toLocaleString()}</strong></span>
          {appliedFilter && <span>Filtered: <strong>{filteredPackets.length.toLocaleString()}</strong></span>}
          {markedPackets.size > 0 && <span>Marked: <strong>{markedPackets.size}</strong></span>}
          {searchResults.length > 0 && <span className="text-blue-600">Found: <strong>{searchResults.length}</strong></span>}
        </div>
        <div className="text-gray-500">
          Right-click for context menu • Ctrl+F to search • Scroll to load more
        </div>
      </div>
    </div>
  );
};

export default WiresharkViewer;
