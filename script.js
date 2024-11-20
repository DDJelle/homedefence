// Array om alle hexagonen bij te houden
const hexagonLayers = {};
let selectedPolygon = null; // Bijhouden welke hexagoon momenteel is geselecteerd
let transparencyEnabled = true; // Bijhouden of transparantie actief is
let editableHexagons = []; // Hexagons die bewerkt mogen worden
let baseMarker = null; // Marker for the base location
let userMarker = null; // Marker for the user's current location

// Initialize the map with OpenStreetMap tile layer
const map = L.map('map', {
  zoom: 19, // Startzoom
  maxZoom: 19, // Maximaal zoomniveau
  zoomControl: false // Disable the default zoom control
});

// Add custom zoom control in the bottom right
L.control.zoom({
  position: 'bottomright'
}).addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

// Custom icon for the base marker using Material Design home icon
const baseIcon = L.divIcon({
  html: '<i class="material-icons" style="color: red; font-size: 24px;">home</i>',
  className: 'custom-div-icon',
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  popupAnchor: [0, -24]
});

// Function to get hexagon boundaries from H3
function getHexBoundary(hexId) {
  const coords = h3.h3ToGeoBoundary(hexId, true);
  return coords.map(([lng, lat]) => [lat, lng]); // Omdraaien naar [lat, lng]
}

// Function to toggle transparency of all hexagons
function toggleTransparency() {
  transparencyEnabled = !transparencyEnabled; // Wissel de status
  Object.values(hexagonLayers).forEach((polygon) => {
    const newOpacity = transparencyEnabled ? 0 : 0.8; // Transparant of zichtbaar
    polygon.setStyle({ fillOpacity: newOpacity });
  });
}

// Event listener voor de transparantie-toggle knop
document.getElementById('toggleButton').addEventListener('click', toggleTransparency);

// Function to show the color selector
function showColorSelector(polygon, latlng, hexId) {
  if (transparencyEnabled) {
    alert("Toggle build mode to place defensive structures in adjacent hexagons.");
    return;
  }

  if (!editableHexagons.includes(hexId)) {
    alert("You're too far away! Go closer to be able to build something.");
    return;
  }

  selectedPolygon = polygon; // Hexagoon opslaan
  const colorSelector = document.getElementById('colorSelector');
  colorSelector.style.display = 'block';
  colorSelector.style.top = `${latlng.y}px`;
  colorSelector.style.left = `${latlng.x}px`;
}

// Function to set the color of the selected polygon
function setColor(color) {
  if (selectedPolygon) {
    selectedPolygon.setStyle({ fillColor: color, fillOpacity: 0.6 });
    document.getElementById('colorSelector').style.display = 'none'; // Verberg het kleurmenu
    selectedPolygon = null;
  }
}

// Function to cancel color selection
function cancelColorSelection() {
  document.getElementById('colorSelector').style.display = 'none'; // Verberg het kleurmenu
  selectedPolygon = null;
}

// Event listeners voor de kleurknoppen
document.getElementById('blackButton').addEventListener('click', () => setColor('black'));
document.getElementById('redButton').addEventListener('click', () => setColor('red'));
document.getElementById('cancelButton').addEventListener('click', cancelColorSelection);

// Overpass API helper function
async function fetchRoads(bbox) {
  const query = `
    [out:json];
    (
      way["highway"~"^(primary|secondary|tertiary|residential)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    out geom;
  `;

  const url = `https://overpass.kumi.systems/api/interpreter?data=${encodeURIComponent(query)}`; // Alternatieve Overpass server

  console.log("Fetching roads for bbox:", bbox);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Overpass API error");
    const data = await response.json();

    // Debugging API-respons
    console.log("Overpass API Response:", data);

    return data;
  } catch (error) {
    console.error("Error fetching Overpass API data:", error);
    return null;
  }
}

// Function to check if a hexagon contains a road
function isStreet(hexBoundary, roads) {
  const hexPolygon = turf.polygon([hexBoundary]);
  console.log("Hexagon Polygon:", hexPolygon);

  for (const road of roads) {
    if (road.geometry && road.geometry.length > 0) {
      const roadLine = turf.lineString(road.geometry.map(coord => [coord.lat, coord.lon]));
      console.log("Road LineString:", roadLine);

      if (turf.booleanIntersects(hexPolygon, roadLine)) {
        console.log("Intersection found between hexagon and road.");
        return true;
      }
    }
  }
  return false;
}

// Add roads to map
async function addRoadsToMap(bbox) {
  const data = await fetchRoads(bbox);

  if (!data || !data.elements) {
    console.warn("No data received from Overpass API.");
    return [];
  }

  const roads = [];

  data.elements.forEach((element) => {
    if (element.type === "way" && element.geometry) {
      const latlngs = element.geometry.map((point) => [point.lat, point.lon]);

      if (latlngs.length > 0) {
        L.polyline(latlngs, {
          color: "blue",
          weight: 0
        }).addTo(map);

        roads.push(element);
      }
    }
  });

  return roads;
}

// Function to generate hexagon grid and place base marker
async function generateHexagons(centerLat, centerLng) {
  const resolution = 13;
  const radius = 15;

  const hexIds = h3.kRing(h3.geoToH3(centerLat, centerLng, resolution), radius);

  // Combine bounding boxes for all hexagons
  const allBoundaries = hexIds.map(h3ToBBox);
  const combinedBBox = combineBoundingBoxes(allBoundaries);

  // Fetch and display roads for the combined area
  const roads = await addRoadsToMap(combinedBBox);
  console.log("Fetched Roads:", roads);

  hexIds.forEach((hexId) => {
    const boundary = getHexBoundary(hexId);
    console.log("Hexagon Boundary:", boundary);

    if (boundary.length) {
      const isHexStreet = isStreet(boundary, roads);
      const fillColor = isHexStreet ? "white" : "brown";
      const fillOpacity = transparencyEnabled ? 0 : 0.6;

      const polygon = L.polygon(boundary, {
        color: "black", // Randkleur
        weight: 1, // Dunne rand
        fillColor: fillColor, // Kleur afhankelijk van straat of gebouw
        fillOpacity: fillOpacity, // Vul kleur
      }).addTo(map);

      hexagonLayers[hexId] = polygon;

      polygon.on("click", (e) => {
        showColorSelector(polygon, map.latLngToContainerPoint(e.latlng), hexId);
      });
    }
  });

  const currentHexId = h3.geoToH3(centerLat, centerLng, resolution);
  editableHexagons = h3.kRing(currentHexId, 1); // Alleen aangrenzende hexagonen
  console.log("Editable hexagons:", editableHexagons);

  // Place a marker at the center coordinates with the custom Material Design home icon
  if (baseMarker) {
    baseMarker.setLatLng([centerLat, centerLng]);
  } else {
    baseMarker = L.marker([centerLat, centerLng], { icon: baseIcon }).addTo(map).bindPopup("Base Location").openPopup();
  }
}

// Combine bounding boxes for multiple hexagons
function combineBoundingBoxes(bboxes) {
  const south = Math.min(...bboxes.map((box) => box.south));
  const west = Math.min(...bboxes.map((box) => box.west));
  const north = Math.max(...bboxes.map((box) => box.north));
  const east = Math.max(...bboxes.map((box) => box.east));

  return { south, west, north, east };
}

// Function to calculate bounding box for a hexagon
function h3ToBBox(hexId) {
  const boundary = h3.h3ToGeoBoundary(hexId, true);
  const lats = boundary.map(([lng, lat]) => lat);
  const lngs = boundary.map(([lng, lat]) => lng);

  // Zorg dat de bounding box correct is geordend
  const bbox = {
    south: Math.min(...lats),
    west: Math.min(...lngs),
    north: Math.max(...lats),
    east: Math.max(...lngs),
  };

  // Debugging bounding box
  console.log("Hexagon BBox:", bbox);

  return bbox;
}

// Function to update user position marker
function updateUserPosition(position) {
  const userCoords = [position.coords.latitude, position.coords.longitude];
  if (!userMarker) {
    userMarker = L.marker(userCoords).addTo(map).bindPopup('You are here');
  } else {
    userMarker.setLatLng(userCoords);
  }

  // Update currentHexId based on user's current location
  const currentHexId = h3.geoToH3(userCoords[0], userCoords[1], 13);
  editableHexagons = h3.kRing(currentHexId, 1); // Alleen aangrenzende hexagonen
  console.log("Editable hexagons:", editableHexagons);
}

// Watch user position
if (navigator.geolocation) {
  navigator.geolocation.watchPosition(updateUserPosition);
} else {
  alert("Geolocation is not supported by this browser.");
}

// Event listener to set base coordinates by clicking on the map
map.on('click', function(e) {
  const { lat, lng } = e.latlng;
  generateHexagons(lat, lng);
  map.off('click'); // Remove the click event listener after setting the base location
});

// Show a popup message to instruct the user
setTimeout(() => {
  alert("Please click on the map to set your base location.");
}, 500);

// Get the user's current location and center the map
navigator.geolocation.getCurrentPosition(
  (position) => {
    const { latitude, longitude } = position.coords;

    // Center the map on the user's location
    map.setView([latitude, longitude], 19); // Stel in op zoomniveau 19
  },
  (error) => {
    console.error("Could not retrieve location:", error);
    alert("Location cannot be determined. Please ensure location services are enabled.");
  }
);