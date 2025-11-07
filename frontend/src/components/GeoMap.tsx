import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import { authFetch } from '../contexts/AuthContext';
import { RefreshCw, Globe, MapPin } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

interface GeoLocation {
  ip: string;
  lat: number;
  lon: number;
  country: string;
  country_code: string;
  city: string;
  packets: number;
  bytes: number;
}

interface GeoMapProps {
  fileId: string | null;
}

// Component to auto-fit bounds when data changes
function FitBounds({ locations }: { locations: GeoLocation[] }) {
  const map = useMap();
  
  useEffect(() => {
    if (locations.length > 0) {
      const bounds = locations.map(loc => [loc.lat, loc.lon] as [number, number]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 });
    }
  }, [locations, map]);
  
  return null;
}

const GeoMap = ({ fileId }: GeoMapProps) => {
  const [locations, setLocations] = useState<GeoLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, countries: 0, cities: 0 });

  const fetchGeoData = async () => {
    if (!fileId) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await authFetch(`http://localhost:8000/api/geomap/${fileId}`);
      if (!response.ok) {
        if (response.status === 503) {
          throw new Error('GeoIP database not available. Please download GeoLite2-City.mmdb');
        }
        throw new Error('Failed to fetch geo data');
      }
      
      const data = await response.json();
      setLocations(data.locations || []);
      
      const uniqueCountries = new Set(data.locations.map((l: GeoLocation) => l.country_code)).size;
      const uniqueCities = new Set(data.locations.map((l: GeoLocation) => `${l.city}-${l.country_code}`)).size;
      
      setStats({
        total: data.total || 0,
        countries: uniqueCountries,
        cities: uniqueCities,
      });
    } catch (err: any) {
      console.error('Failed to fetch geo data:', err);
      setError(err.message || 'Failed to load geographic data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchGeoData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-green-100 to-blue-100 mb-4 animate-pulse">
            <Globe className="h-8 w-8 text-green-600 animate-spin" />
          </div>
          <p className="text-gray-600 font-medium">Loading geographic data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center p-8 bg-red-50 rounded-2xl border border-red-100 max-w-md">
          <p className="text-red-600 font-medium mb-4">{error}</p>
          <div className="text-sm text-gray-600 mb-4">
            <p>To enable GeoIP features:</p>
            <ol className="list-decimal list-inside text-left mt-2 space-y-1">
              <li>Install: <code className="bg-gray-100 px-1 rounded">pip install geoip2</code></li>
              <li>Download GeoLite2-City.mmdb from MaxMind</li>
              <li>Place it in: <code className="bg-gray-100 px-1 rounded">backend/</code></li>
              <li>Restart the backend server</li>
            </ol>
          </div>
          <button
            onClick={fetchGeoData}
            className="inline-flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 mb-4">
            <MapPin className="h-8 w-8 text-gray-400" />
          </div>
          <p className="text-gray-500 font-medium">No geographic data available</p>
          <p className="text-sm text-gray-400 mt-2">All IPs appear to be private/local addresses</p>
        </div>
      </div>
    );
  }

  // Calculate marker size based on traffic
  const getMarkerSize = (packets: number) => {
    const maxPackets = Math.max(...locations.map(l => l.packets));
    const minSize = 5;
    const maxSize = 25;
    return minSize + ((packets / maxPackets) * (maxSize - minSize));
  };

  // Get color based on traffic volume
  const getMarkerColor = (packets: number) => {
    const maxPackets = Math.max(...locations.map(l => l.packets));
    const ratio = packets / maxPackets;
    
    if (ratio > 0.7) return '#ef4444'; // red
    if (ratio > 0.4) return '#f97316'; // orange
    if (ratio > 0.2) return '#eab308'; // yellow
    return '#3b82f6'; // blue
  };

  return (
    <div className="relative h-full w-full">
      {/* Stats Panel */}
      <div className="absolute top-4 left-4 z-[1000] bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Globe className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-gray-800">Geographic Distribution</h3>
        </div>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-600">IP Locations:</span>
            <span className="font-mono font-semibold text-gray-800">{stats.total}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-600">Countries:</span>
            <span className="font-mono font-semibold text-gray-800">{stats.countries}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-600">Cities:</span>
            <span className="font-mono font-semibold text-gray-800">{stats.cities}</span>
          </div>
        </div>
        <button
          onClick={fetchGeoData}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors text-xs font-medium"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div className="absolute top-4 right-4 z-[1000] bg-white/95 backdrop-blur-md rounded-xl shadow-lg border border-gray-200 p-3">
        <div className="text-xs font-semibold text-gray-800 mb-2">Traffic Volume</div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-red-500"></div>
            <span className="text-xs text-gray-600">High (70-100%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3.5 h-3.5 rounded-full bg-orange-500"></div>
            <span className="text-xs text-gray-600">Medium (40-70%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
            <span className="text-xs text-gray-600">Low (20-40%)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500"></div>
            <span className="text-xs text-gray-600">Minimal (0-20%)</span>
          </div>
        </div>
      </div>

      {/* Map */}
      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ height: '100%', width: '100%' }}
        className="rounded-lg"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        
        <FitBounds locations={locations} />
        
        {locations.map((location, idx) => (
          <CircleMarker
            key={`${location.ip}-${idx}`}
            center={[location.lat, location.lon]}
            radius={getMarkerSize(location.packets)}
            fillColor={getMarkerColor(location.packets)}
            color="#fff"
            weight={2}
            opacity={0.9}
            fillOpacity={0.7}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="text-lg">{location.country_code}</span>
                  {location.ip}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Country:</span>
                    <span className="font-medium">{location.country}</span>
                  </div>
                  {location.city && location.city !== 'Unknown' && (
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600">City:</span>
                      <span className="font-medium">{location.city}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 my-2"></div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Packets:</span>
                    <span className="font-mono font-semibold">{location.packets.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Bytes:</span>
                    <span className="font-mono font-semibold">{location.bytes.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="text-gray-600">Location:</span>
                    <span className="font-mono text-[10px]">
                      {location.lat.toFixed(4)}, {location.lon.toFixed(4)}
                    </span>
                  </div>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

export default GeoMap;
