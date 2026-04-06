import folium
import pandas as pd

# Load crime data from CSV file
df = pd.read_csv("crime_data.csv")

# Create a base map centered around the first data point
safety_map = folium.Map(location=[df["latitude"].mean(), df["longitude"].mean()], zoom_start=12)

# Add dynamic heatmap markers
for _, row in df.iterrows():
    folium.CircleMarker(
        location=[row["latitude"], row["longitude"]],
        radius=10,  # Size of marker
        color="red" if row["risk_level"] > 2 else "orange" if row["risk_level"] == 2 else "green",
        fill=True,
        fill_opacity=0.6,
        popup=f"Risk Level: {row['risk_level']}"
    ).add_to(safety_map)

# Save the heatmap to an HTML file
safety_map.save("safety_map.html")

print("Heatmap generated successfully! Open 'safety_map.html' to view.")
