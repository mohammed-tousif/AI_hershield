from flask import Flask, render_template, request, jsonify
from datetime import datetime
from flask_cors import CORS
import csv
import os
import json
from report_routes import report_routes

app = Flask(__name__)
# Enable CORS with specific settings
CORS(app, resources={
    r"/*": {
        "origins": "*",
        "methods": ["GET", "POST", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

# Enable debug mode
app.config['DEBUG'] = True

REPORTS_FILE = 'incident_reports.csv'

def initialize_csv():
    if not os.path.exists(REPORTS_FILE):
        with open(REPORTS_FILE, 'w', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                'Report ID',
                'Incident Type',
                'Location',
                'Date and Time',
                'Description',
                'Reported At'
            ])
        print(f"CSV file created at: {os.path.abspath(REPORTS_FILE)}")

# Initialize CSV file at startup
initialize_csv()

def save_report(report):
    try:
        with open(REPORTS_FILE, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                report['id'],
                report['type'],
                report['location'],
                report['coordinates'].get('lat', ''),
                report['coordinates'].get('lng', ''),
                report['datetime'],
                report['description'],
                report['reported_at']
            ])
        return True
    except Exception as e:
        print(f"Error saving report: {str(e)}")
        return False

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/report-incident', methods=['POST'])
def report_incident():
    try:
        data = request.get_json()
        print("Received data:", data)  # Debug print

        # Validate required fields
        required_fields = ['type', 'location', 'datetime', 'description']
        missing_fields = [field for field in required_fields if not data.get(field)]
        
        if missing_fields:
            return jsonify({
                'status': 'error',
                'message': f'Missing fields: {", ".join(missing_fields)}'
            }), 400

        # Create report ID
        report_id = f"INC{datetime.now().strftime('%Y%m%d%H%M%S')}"

        # Get coordinates if available
        coordinates = data.get('coordinates', {})
        lat = coordinates.get('lat', '')
        lng = coordinates.get('lng', '')

        # Save to CSV
        with open(REPORTS_FILE, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                report_id,
                data['type'],
                data['location'],
                lat,  # Add latitude
                lng,  # Add longitude
                data['datetime'],
                data['description'],
                datetime.now().isoformat()
            ])

        return jsonify({
            'status': 'success',
            'message': 'Report submitted successfully',
            'report_id': report_id
        })

    except Exception as e:
        print(f"Error in report_incident: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

# Register the report routes blueprint
app.register_blueprint(report_routes)

if __name__ == '__main__':
    # Initialize CSV file at startup
    initialize_csv()
    # Run the app on all network interfaces
    app.run(host='0.0.0.0', port=5000, debug=True)