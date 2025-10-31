import React, { useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Position,
  MarkerType,
} from '@xyflow/react';
import axios from 'axios';
import CustomNode from './CustomNode';
import dagre from 'dagre';

const initialNodes = [];
const initialEdges = [];

const nodeTypes = { custom: CustomNode };

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const nodeWidth = 172;
const nodeHeight = 36;

const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = {
      x: nodeWithPosition.x - nodeWidth / 2,
      y: nodeWithPosition.y - nodeHeight / 2,
    };

    return node;
  });

  return { nodes, edges };
};

const NetworkGraph = ({ fileId }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), [setEdges]);

  useEffect(() => {
    if (!fileId) return;

    const fetchConversations = async () => {
      try {
        const response = await axios.get(`http://localhost:8000/api/conversations/${fileId}`);
        const { nodes: apiNodes, edges: apiEdges } = response.data;

        const reactFlowNodes = apiNodes.map((node, index) => ({
          id: String(node.id) + (node.id ? '' : `-${index}`),
          type: 'custom',
          data: { label: node.label },
          position: { x: 0, y: 0 }, // Position will be set by layout algorithm
        }));

        const reactFlowEdges = apiEdges
          .filter(edge => edge.from !== null && edge.from !== undefined && edge.to !== null && edge.to !== undefined)
          .map((edge) => ({
            id: `e${edge.from}-${edge.to}`,
            source: String(edge.from),
            target: String(edge.to),
            animated: true,
            label: edge.label,
            markerEnd: { type: MarkerType.ArrowClosed }, // Add arrow to edges
          }));

        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(reactFlowNodes, reactFlowEdges);

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      } catch (err) {
        console.error('Failed to fetch conversation data.', err);
      }
    };

    fetchConversations();
  }, [fileId, setNodes, setEdges]);

  return (
    <div style={{ height: '500px', border: '1px solid lightgray' }}>
      <h2>Network Conversations</h2>
      <div style={{ width: '100%', height: '100%' }}>
        {nodes.length > 0 && edges.length > 0 && (
          <ReactFlow
            key={fileId}
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
          >
            <Controls />
            <Background />
          </ReactFlow>
        )}
      </div>
    </div>
  );
};

export default NetworkGraph;