import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import axios from "axios";

// 🔥 Default location (Chhatrapati Sambhajinagar, change if needed)
const DEFAULT_POSITION = [19.8762, 75.3433];

const HotspotsMap = () => {
  const [hotspots, setHotspots] = useState([]);

  useEffect(() => {
    axios
      .get("http://localhost:5000/hotspots") // Fetch from backend
      .then((response) => {
        if (response.data.message) {
          console.log("⚠️ No hotspots available!");
        } else {
          setHotspots(response.data);
        }
      })
      .catch((error) => console.error("❌ Error fetching hotspots:", error));
  }, []);

  return (
    <div style={{ width: "100%", height: "500px" }}>
      <MapContainer center={DEFAULT_POSITION} zoom={13} style={{ height: "100%", width: "100%" }}>
        {/* Map Layer */}
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

        {/* Markers for each hotspot */}
        {hotspots.map((hotspot) => (
          <Marker key={hotspot.id} position={[hotspot.latitude, hotspot.longitude]}>
            <Popup>{hotspot.description}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
};

export default HotspotsMap;
