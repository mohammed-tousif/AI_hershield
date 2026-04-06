import folium
from folium import plugins
import pandas as pd
from geopy.geocoders import Nominatim
from geopy.location import Location
import requests
import webbrowser
import os
import geocoder
import numpy as np
from math import radians, sin, cos, sqrt, atan2

def calculate_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two points using Haversine formula"""
    R = 6371  # Earth's radius in kilometers

    lat1, lon1, lat2, lon2 = map(radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1

    a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
    c = 2 * atan2(sqrt(a), sqrt(1-a))
    distance = R * c

    return distance

def point_to_line_distance(point, start, end):
    """Calculate the minimum distance from a point to a line segment"""
    # Convert inputs to numpy arrays with float type
    point = np.array([float(point[0]), float(point[1])])
    start = np.array([float(start[0]), float(start[1])])
    end = np.array([float(end[0]), float(end[1])])
    
    # Vector from start to end
    line_vec = end - start
    # Vector from start to point
    point_vec = point - start
    # Length of line
    line_len = np.linalg.norm(line_vec)
    
    if line_len == 0:
        return np.linalg.norm(point_vec)
    
    # Normalized dot product
    t = max(0, min(1, np.dot(point_vec, line_vec) / (line_len * line_len)))
    # Project point onto line segment
    projection = start + t * line_vec
    
    return np.linalg.norm(point - projection)

def is_point_near_route(point, route_coords, max_distance_km=5):
    """Check if a point is within the specified distance of the route"""
    point_lat, point_lon = float(point[0]), float(point[1])
    min_distance = float('inf')
    
    # Convert route coordinates from [lon, lat] to [lat, lon]
    route_points = [[float(coord[1]), float(coord[0])] for coord in route_coords]
    
    # Check distance to each route segment
    for i in range(len(route_points) - 1):
        start = route_points[i]
        end = route_points[i + 1]
        
        # Calculate the minimum distance from point to route segment
        distance = point_to_line_distance(
            [point_lat, point_lon],
            start,
            end
        )
        
        # Convert distance to approximate kilometers (rough approximation)
        distance_km = distance * 111  # 1 degree ≈ 111 km
        min_distance = min(min_distance, distance_km)
        
        if min_distance <= max_distance_km:
            return True
            
    return False

def get_location_from_address(address):
    """Get coordinates from address using Nominatim"""
    try:
        geolocator = Nominatim(user_agent="safety_navigator")
        location = geolocator.geocode(address)
        if location:
            return [location.latitude, location.longitude]
    except:
        return None

def get_current_location():
    """Get the current location using multiple methods or manual input"""
    # First ask if user wants to enter location manually
    choice = input("Do you want to enter your location manually? (yes/no): ").lower().strip()
    
    # If user chooses 'no', immediately return KLS VDI Haliyal as default
    if not choice.startswith('y'):
        return [15.3227, 74.7549], "KLS Vishwanathrao Deshpande Institute of Technology, Haliyal"
    
    # If user chooses 'yes', allow manual input
    address = input("Enter your location (city, area, or full address): ")
    coords = get_location_from_address(address)
    if coords:
        print(f"Successfully located your position at: {coords[0]}, {coords[1]}")
        return coords, address
    
    # If manual input fails, use KLS VDI Haliyal as default
    return [15.3227, 74.7549], "KLS Vishwanathrao Deshpande Institute of Technology, Haliyal"

def get_route(start_coords, end_coords):
    """Get routing data between two points using OSRM"""
    url = f"http://router.project-osrm.org/route/v1/driving/{start_coords[1]},{start_coords[0]};{end_coords[1]},{end_coords[0]}?overview=full&geometries=geojson"
    response = requests.get(url)
    route_data = response.json()
    return route_data['routes'][0]['geometry']['coordinates']

def create_safety_map():
    # Load crime data
    df = pd.read_csv("crime_data.csv", comment='#', skip_blank_lines=True)
    
    # Get current location and start address
    current_location, start_address = get_current_location()
    
    # Get destination
    destination = input("Enter your destination (address or landmark): ")
    
    # Create base map centered on current location
    safety_map = folium.Map(location=current_location, zoom_start=12)
    
    try:
        # Geocode destination
        geolocator = Nominatim(user_agent="safety_navigator")
        destination_location = geolocator.geocode(destination)
        
        if destination_location:
            dest_coords = [destination_location.latitude, destination_location.longitude]
            
            # Get the route
            route_coords = get_route(current_location, dest_coords)
            
            # Add route to map
            route_points = [[lat, lon] for lon, lat in route_coords]
            folium.PolyLine(
                route_points,
                weight=3,
                color='blue',
                opacity=0.8
            ).add_to(safety_map)
            
            # Add crime data markers only along the route
            for _, row in df.iterrows():
                try:
                    point = [float(row["latitude"]), float(row["longitude"])]
                    if is_point_near_route(point, route_coords):
                        color = "red" if row["risk_level"] > 2 else "orange" if row["risk_level"] == 2 else "green"
                        risk_text = "High Risk" if row["risk_level"] > 2 else "Moderate Risk" if row["risk_level"] == 2 else "Low Risk"
                        
                        folium.CircleMarker(
                            location=point,
                            radius=8,
                            color=color,
                            fill=True,
                            fill_opacity=0.7,
                            popup=folium.Popup(
                                f"Location: {row['location']}<br>"
                                f"Risk Level: {risk_text}<br>"
                                f"Coordinates: {point[0]:.4f}, {point[1]:.4f}",
                                max_width=300
                            )
                        ).add_to(safety_map)
                except (ValueError, TypeError):
                    continue  # Skip any rows with invalid data
            
            # Add markers for start and end points
            folium.Marker(
                location=current_location,
                popup=f"Start: {start_address}",
                icon=folium.Icon(color='green', icon='info-sign')
            ).add_to(safety_map)
            
            folium.Marker(
                location=dest_coords,
                popup=f"Destination: {destination}",
                icon=folium.Icon(color='red', icon='info-sign')
            ).add_to(safety_map)
            
            # Adjust map bounds to show the entire route
            bounds = [route_points[0], route_points[-1]]
            safety_map.fit_bounds(bounds)
            
            return safety_map, current_location
            
        else:
            print("Could not find the specified destination.")
            return None, None
            
    except Exception as e:
        print(f"An error occurred: {str(e)}")
        return None, None

def main():
    # Create map
    safety_map, current_location = create_safety_map()
    
    if safety_map:
        # Save and open the map
        map_file = "safety_route_map.html"
        safety_map.save(map_file)
        webbrowser.open('file://' + os.path.realpath(map_file))
        print(f"Map generated successfully! Opening {map_file}")
    else:
        print("Failed to generate the map. Please try again with valid locations.")

if __name__ == "__main__":
    main() 