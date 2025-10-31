import React, { useEffect, useRef, useState } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import axios from 'axios';

const NetworkGraph = ({ fileId }) => {
  const visJsRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!fileId) return;

    const fetchConversations = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`http://localhost:8000/api/conversations/${fileId}`);
        const { nodes, edges } = response.data;

        const data = {
          nodes: new DataSet(nodes),
          edges: new DataSet(edges),
        };

        const options = {
          layout: {
            hierarchical: false
          },
          edges: {
            color: "#000000"
          },
          height: "500px"
        };

        if (visJsRef.current) {
          new Network(visJsRef.current, data, options);
        }

      } catch (err) {
        setError('Failed to fetch conversation data.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchConversations();
  }, [fileId, visJsRef]);

  if (loading) return <div>Loading graph...</div>;
  if (error) return <div>{error}</div>;

  return (
    <div style={{ height: '500px', border: '1px solid lightgray' }}>
      <h2>Network Conversations</h2>
      <div ref={visJsRef} style={{ height: "100%" }} />
    </div>
  );
};

export default NetworkGraph;