import { useEffect, useCallback, useState, useRef } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  MarkerType,
  Panel,
  useReactFlow,
  type Node,
} from '@xyflow/react';
import { authFetch } from '../contexts/AuthContext';
import CustomNode from './CustomNode';
import CustomEdge from './CustomEdge';
import dagre from 'dagre';
import { 
  Activity, 
  RefreshCw, 
  Search, 
  Rows, 
  Columns, 
  Maximize,
  Eye,
  EyeOff,
  Copy,
  Filter,
  AlertCircle,
  Zap,
  Download
} from 'lucide-react';

const initialNodes: any[] = [];
const initialEdges: any[] = [];

const nodeTypes = { custom: CustomNode };
const edgeTypes = { custom: CustomEdge };

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 200;
const nodeHeight = 60;

const getLayoutedElements = (nodes: any[], edges: any[], direction = 'TB') => {
  dagreGraph.setGraph({ rankdir: direction, nodesep: 100, ranksep: 150 });

  nodes.forEach((node: any) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge: any) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node: any) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes, edges };
};

interface NetworkGraphProps {
  fileId: string | null;
}

const NetworkGraph = ({ fileId }: NetworkGraphProps) => {
  const { fitView, getNodes } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalNodes: 0, totalConnections: 0 });
  const [direction, setDirection] = useState<'TB' | 'LR'>('TB');
  const [searchQuery, setSearchQuery] = useState('');
  const [protocolFilter, setProtocolFilter] = useState<'ALL' | 'TCP' | 'UDP' | 'ICMP' | 'TLS' | 'HTTP' | 'DNS' | 'SSH'>('ALL');
  const [portFilter, setPortFilter] = useState<string>('');
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    node: Node | null;
  }>({ visible: false, x: 0, y: 0, node: null });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeSummary, setNodeSummary] = useState<any | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  
  // export PNG of the graph area
  const exportToPng = async () => {
    if (!reactFlowWrapper.current) return;
    try {
      const mod: any = await import('html-to-image');
      const dataUrl = await mod.toPng(reactFlowWrapper.current, {
        backgroundColor: '#ffffff',
        pixelRatio: 2,
        filter: (node: HTMLElement) => !(node as any).dataset?.exportIgnore,
      });
      const link = document.createElement('a');
      link.download = `network-graph-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Export failed. Ensure html-to-image is installed.', err);
      alert('Export failed. Please run: npm i html-to-image');
    }
  };
  
  const onConnect = useCallback((params: any) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  const fetchNodeSummary = useCallback(async (ip: string) => {
    try {
      const res = await authFetch(`http://localhost:8000/api/node/${fileId}/${ip}`);
      if (!res.ok) throw new Error('Failed node summary');
      const data = await res.json();
      setNodeSummary(data);
      setSidebarOpen(true);
    } catch (e) {
      console.error(e);
      setNodeSummary(null);
    }
  }, [fileId]);

  // Handle node context menu
  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    event.nativeEvent.preventDefault();
    event.stopPropagation();
    if (reactFlowWrapper.current) {
      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      setContextMenu({
        visible: true,
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
        node,
      });
    }
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as HTMLElement)) {
        setContextMenu({ visible: false, x: 0, y: 0, node: null });
      }
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.visible]);

  // Context menu actions
  const handleCopyIP = () => {
    if (contextMenu.node) {
      navigator.clipboard.writeText(String(contextMenu.node.data.label || ''));
      setContextMenu({ visible: false, x: 0, y: 0, node: null });
    }
  };

  const handleIsolateNode = () => {
    if (contextMenu.node) {
      setSearchQuery(String(contextMenu.node.data.label || ''));
      setContextMenu({ visible: false, x: 0, y: 0, node: null });
    }
  };

  const handleShowConnections = () => {
    if (contextMenu.node) {
      const nodeId = contextMenu.node.id;
      const connectedNodeIds = new Set<string>();
      
      edges.forEach((edge) => {
        if (edge.source === nodeId || edge.target === nodeId) {
          connectedNodeIds.add(edge.source);
          connectedNodeIds.add(edge.target);
        }
      });

      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            hasQuery: true,
            highlighted: connectedNodeIds.has(n.id),
          },
        }))
      );

      setEdges((eds) =>
        eds.map((e) => ({
          ...e,
          data: {
            ...e.data,
            dimmed: !(connectedNodeIds.has(e.source) && connectedNodeIds.has(e.target)),
          },
        }))
      );

      setContextMenu({ visible: false, x: 0, y: 0, node: null });
    }
  };

  const handleHideNode = () => {
    if (contextMenu.node) {
      const nodeId = contextMenu.node.id;
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setContextMenu({ visible: false, x: 0, y: 0, node: null });
    }
  };

  const handleFocusNode = () => {
    if (contextMenu.node) {
      const node = nodes.find((n) => n.id === contextMenu.node!.id);
      if (node) {
        fitView({
          nodes: [node],
          duration: 500,
          padding: 0.5,
        });
      }
      setContextMenu({ visible: false, x: 0, y: 0, node: null });
    }
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          hasQuery: false,
          highlighted: false,
        },
      }))
    );
    setEdges((eds) =>
      eds.map((e) => ({
        ...e,
        data: {
          ...e.data,
          dimmed: false,
        },
      }))
    );
    setContextMenu({ visible: false, x: 0, y: 0, node: null });
  };

  const fetchConversations = async () => {
    if (!fileId) return;
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await authFetch(`http://localhost:8000/api/conversations/${fileId}`);
      if (!response.ok) throw new Error('Failed to fetch conversations');
      const { nodes: apiNodes, edges: apiEdges } = await response.json();

      const reactFlowNodes = apiNodes.map((node: any, index: number) => ({
        id: String(node.id) + (node.id ? '' : `-${index}`),
        type: 'custom',
        data: { 
          label: node.label,
          connections: apiEdges.filter((e: any) => e.from === node.id || e.to === node.id).length
        },
        position: { x: 0, y: 0 },
      }));

      const reactFlowEdges = apiEdges
        .filter((edge: any) => edge.from !== null && edge.from !== undefined && edge.to !== null && edge.to !== undefined)
        .map((edge: any) => ({
          id: `e${edge.from}-${edge.to}`,
          source: String(edge.from),
          target: String(edge.to),
          type: 'custom',
          animated: true,
          data: {
            label: edge.title || `${edge.value || edge.packets || 0} packets`,
            protocol: edge.protocol || edge.proto || undefined,
            sport: edge.sport || edge.src_port || undefined,
            dport: edge.dport || edge.dst_port || undefined,
            port: edge.port || undefined,
            packets: edge.packets || edge.count || edge.value || 0,
            bytes: edge.bytes || edge.size || 0,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
        }));

      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(reactFlowNodes, reactFlowEdges, direction);

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setStats({
        totalNodes: layoutedNodes.length,
        totalConnections: layoutedEdges.length
      });
    } catch (err) {
      console.error('Failed to fetch conversation data.', err);
      setError('Failed to load network graph');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, direction]);

  // Filters + search: dim edges/nodes that don't match
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    const ports = new Set(
      portFilter
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => Number(p))
        .filter((n) => !Number.isNaN(n))
    );

    const hasAnyFilter = Boolean(q) || protocolFilter !== 'ALL' || ports.size > 0;
    const currentNodes = getNodes();

    setEdges((currentEdges) => {
      const visibleEdgePairs = new Set<string>();

      const nextEdges = currentEdges.map((e) => {
        const d: any = e.data || {};
        const proto = String(d.protocol || d.proto || '').toUpperCase();
        const label = String(d.label || '').toLowerCase();
        const sourceMatch = q && String(currentNodes.find((n) => n.id === e.source)?.data?.label || '').toLowerCase().includes(q);
        const targetMatch = q && String(currentNodes.find((n) => n.id === e.target)?.data?.label || '').toLowerCase().includes(q);
        const labelMatch = q && label.includes(q);

        // protocol matches if filter is ALL or proto equals filter or label contains it
        const protoMatch =
          protocolFilter === 'ALL' ||
          proto === protocolFilter ||
          label.includes(protocolFilter.toLowerCase());

        // port matches if no ports provided, or any matches sport/dport/port or appears in label
        const edgePorts = [d.sport, d.dport, d.port]
          .map((v: any) => Number(v))
          .filter((n: number) => !Number.isNaN(n));
        const labelNums = Array.from(label.matchAll(/\b(\d{1,5})\b/g)).map((m) => Number(m[1]));
        const anyPortMatch = ports.size === 0 ? true : [...ports].some((p) => edgePorts.includes(p) || labelNums.includes(p));

        const searchMatch = !q || sourceMatch || targetMatch || labelMatch;
        const visible = searchMatch && protoMatch && anyPortMatch;

        if (visible) {
          visibleEdgePairs.add(e.source);
          visibleEdgePairs.add(e.target);
        }

        return {
          ...e,
          data: {
            ...d,
            dimmed: hasAnyFilter ? !visible : false,
          },
        };
      });

      // update nodes highlighting after edges processed
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            hasQuery: hasAnyFilter,
            highlighted: hasAnyFilter ? visibleEdgePairs.has(n.id) || (q && String(n.data?.label || '').toLowerCase().includes(q)) : false,
          },
        }))
      );

      return nextEdges;
    });
  }, [searchQuery, protocolFilter, portFilter, getNodes, setNodes, setEdges]);

  const onToggleDirection = () => {
    setDirection((d) => (d === 'TB' ? 'LR' : 'TB'));
  };

  const onRelayout = () => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes.map((n: any) => ({ ...n })),
      edges.map((e: any) => ({ ...e })),
      direction
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    fitView({ padding: 0.2 });
  };

  const onNodeClick = useCallback((_: any, node: any) => {
    const ip = String(node?.data?.label || '');
    if (ip) {
      setSelectedNode(ip);
      fetchNodeSummary(ip);
    }
  }, [fetchNodeSummary]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-indigo-100 to-purple-100 mb-4 animate-pulse">
            <Activity className="h-8 w-8 text-indigo-600 animate-spin" />
          </div>
          <p className="text-gray-600 font-medium">Loading network graph...</p>
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
            onClick={fetchConversations}
            className="mt-4 inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 mb-4">
            <Activity className="h-8 w-8 text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium">No network conversations found</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div ref={reactFlowWrapper} className="relative h-full w-full bg-white">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeContextMenu={onNodeContextMenu}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          proOptions={{ hideAttribution: true }}
          className="react-flow-custom"
          minZoom={0.2}
          maxZoom={2}
        >
          <Background 
            color="#e5e7eb" 
            gap={16} 
            size={0.5}
            className="opacity-40"
          />
          
          <Controls 
            data-export-ignore
            className="bg-white rounded-lg shadow-lg border border-gray-200"
            showInteractive={false}
            showFitView={false}
          />

          <Panel data-export-ignore position="top-left" className="bg-white rounded-lg shadow-lg border border-gray-200 p-3 m-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 rounded-full bg-blue-400"></div>
                <span className="text-xs font-medium text-gray-700">
                  {stats.totalNodes} Nodes
                </span>
              </div>
              <div className="h-3 w-px bg-gray-300"></div>
              <div className="flex items-center space-x-2">
                <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
                <span className="text-xs font-medium text-gray-700">
                  {stats.totalConnections} Connections
                </span>
              </div>
              {/* Search */}
              <div className="flex-1 min-w-[180px]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search IP..."
                    className="w-full pl-8 pr-2 py-1.5 rounded-md border border-gray-200 focus:border-blue-400 focus:ring-1 focus:ring-blue-100 outline-none text-xs bg-white"
                  />
                </div>
              </div>
              {/* Protocol & Port Filters */}
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <select
                  value={protocolFilter}
                  onChange={(e) => setProtocolFilter(e.target.value as any)}
                  className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white"
                >
                  {['ALL','TCP','UDP','ICMP','TLS','HTTP','DNS','SSH'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  value={portFilter}
                  onChange={(e) => setPortFilter(e.target.value)}
                  placeholder="Ports: 80,443"
                  className="w-[140px] text-xs border border-gray-200 rounded-md px-2 py-1 bg-white"
                />
                <button
                  onClick={() => { setProtocolFilter('ALL'); setPortFilter(''); setSearchQuery(''); }}
                  className="text-xs px-2 py-1 border border-gray-200 rounded-md hover:bg-gray-50"
                  title="Clear filters"
                >
                  Clear
                </button>
              </div>
            </div>
          </Panel>

          <Panel data-export-ignore position="top-right" className="m-4">
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleDirection}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-2 hover:bg-gray-50 transition-all hover:shadow-lg"
                title={`Toggle layout (${direction === 'TB' ? 'Top-Bottom' : 'Left-Right'})`}
              >
                {direction === 'TB' ? (
                  <Rows className="h-4 w-4 text-gray-600" />
                ) : (
                  <Columns className="h-4 w-4 text-gray-600" />
                )}
              </button>
              <button
                onClick={onRelayout}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-2 hover:bg-gray-50 transition-all hover:shadow-lg"
                title="Re-layout & fit"
              >
                <Maximize className="h-4 w-4 text-gray-600" />
              </button>
              <button
                onClick={fetchConversations}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-2 hover:bg-gray-50 transition-all hover:shadow-lg"
                title="Refresh graph"
              >
                <RefreshCw className="h-4 w-4 text-gray-600" />
              </button>
              <button
                onClick={exportToPng}
                className="bg-white rounded-lg shadow-md border border-gray-200 p-2 hover:bg-gray-50 transition-all hover:shadow-lg"
                title="Export as PNG"
              >
                <Download className="h-4 w-4 text-gray-600" />
              </button>
            </div>
          </Panel>
        </ReactFlow>
      </div>
      {/* Node Details Sidebar */}
      {isSidebarOpen && selectedNode && (
        <div className="fixed right-4 top-28 bottom-4 w-80 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
            <div>
              <div className="text-xs text-gray-500">Node</div>
              <div className="text-sm font-semibold text-gray-800 truncate" title={selectedNode}>{selectedNode}</div>
            </div>
            <button className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50" onClick={() => setSidebarOpen(false)}>Close</button>
          </div>
          <div className="p-3 text-xs space-y-3 overflow-y-auto h-full">
            {!nodeSummary ? (
              <div className="text-gray-500">Loading...</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded-lg bg-green-50 border border-green-200">
                    <div className="text-green-700 font-semibold">Outbound</div>
                    <div className="font-mono">{nodeSummary.outbound_packets}</div>
                    <div className="text-gray-600">{nodeSummary.outbound_bytes} bytes</div>
                  </div>
                  <div className="p-2 rounded-lg bg-blue-50 border border-blue-200">
                    <div className="text-blue-700 font-semibold">Inbound</div>
                    <div className="font-mono">{nodeSummary.inbound_packets}</div>
                    <div className="text-gray-600">{nodeSummary.inbound_bytes} bytes</div>
                  </div>
                </div>
                {nodeSummary.geo && !nodeSummary.geo.error && (
                  <div className="p-2 rounded-lg bg-purple-50 border border-purple-200">
                    <div className="text-purple-700 font-semibold mb-1">📍 Location</div>
                    <div className="text-xs space-y-0.5">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-lg">{nodeSummary.geo.country_code || '??'}</span>
                        <span>{nodeSummary.geo.country || 'Unknown'}</span>
                      </div>
                      {nodeSummary.geo.city && nodeSummary.geo.city !== 'Unknown' && (
                        <div className="text-gray-600">🏙️ {nodeSummary.geo.city}</div>
                      )}
                      {nodeSummary.geo.latitude && nodeSummary.geo.longitude && (
                        <div className="text-gray-500 font-mono text-[10px]">
                          {nodeSummary.geo.latitude.toFixed(4)}, {nodeSummary.geo.longitude.toFixed(4)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {nodeSummary.top_protocols?.length > 0 && (
                  <div>
                    <div className="text-gray-700 font-semibold mb-1">Top Protocols</div>
                    <div className="space-y-1">
                      {nodeSummary.top_protocols.map((p: any) => (
                        <div key={p.protocol} className="flex justify-between bg-white border border-gray-200 rounded px-2 py-1">
                          <span>{p.protocol}</span>
                          <span className="font-mono">{p.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-gray-700 font-semibold mb-1">Top Dst Ports</div>
                    <div className="space-y-1">
                      {nodeSummary.top_destination_ports?.map((p: any) => (
                        <div key={p.port} className="flex justify-between bg-white border border-gray-200 rounded px-2 py-1">
                          <span className="font-mono">{p.port}</span>
                          <span>{p.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-700 font-semibold mb-1">Top Src Ports</div>
                    <div className="space-y-1">
                      {nodeSummary.top_source_ports?.map((p: any) => (
                        <div key={p.port} className="flex justify-between bg-white border border-gray-200 rounded px-2 py-1">
                          <span className="font-mono">{p.port}</span>
                          <span>{p.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          <div className="context-menu-item" onClick={handleCopyIP}>
            <Copy />
            <span>Copy IP Address</span>
          </div>
          <div className="context-menu-item" onClick={handleIsolateNode}>
            <Search />
            <span>Isolate Node</span>
          </div>
          <div className="context-menu-item" onClick={handleShowConnections}>
            <Zap />
            <span>Show Direct Connections</span>
          </div>
          <div className="context-menu-item" onClick={handleFocusNode}>
            <Eye />
            <span>Focus on Node</span>
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" onClick={handleHideNode}>
            <EyeOff />
            <span>Hide Node</span>
          </div>
          <div className="context-menu-item" onClick={handleClearFilters}>
            <Filter />
            <span>Clear All Filters</span>
          </div>
          <div className="context-menu-divider"></div>
          <div className="context-menu-item" style={{ color: '#ef4444' }}>
            <AlertCircle />
            <span>Mark as Suspicious</span>
          </div>
        </div>
      )}
    </>
  );
};

export default NetworkGraph;
