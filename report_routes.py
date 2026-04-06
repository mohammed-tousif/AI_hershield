from flask import Blueprint, request, jsonify
from datetime import datetime
import csv
import os

# Create a Blueprint for report routes
report_routes = Blueprint('report_routes', __name__)

# File to store reports
REPORTS_FILE = 'incident_reports.csv'

def initialize_csv():
    try:
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
            print("CSV file created successfully")
        return True
    except Exception as e:
        print(f"Error creating CSV file: {str(e)}")
        return False

def save_to_csv(report_data):
    try:
        with open(REPORTS_FILE, 'a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                report_data['id'],
                report_data['type'],
                report_data['location'],
                report_data['datetime'],
                report_data['description'],
                report_data['reported_at']
            ])
        return True
    except Exception as e:
        print(f"Error saving to CSV: {str(e)}")
        return False

@report_routes.route('/report-incident', methods=['POST'])
def report_incident():
    try:
        # Ensure CSV file exists
        if not initialize_csv():
            return jsonify({
                'status': 'error',
                'message': 'Could not initialize CSV file'
            }), 500

        # Get and validate data
        data = request.get_json()
        if not data:
            return jsonify({
                'status': 'error',
                'message': 'No data received'
            }), 400

        # Check required fields
        required_fields = ['type', 'location', 'datetime', 'description']
        missing_fields = [field for field in required_fields if not data.get(field)]
        if missing_fields:
            return jsonify({
                'status': 'error',
                'message': f'Missing fields: {", ".join(missing_fields)}'
            }), 400

        # Create report
        report_data = {
            'id': f"INC{datetime.now().strftime('%Y%m%d%H%M%S')}",
            'type': data['type'],
            'location': data['location'],
            'datetime': data['datetime'],
            'description': data['description'],
            'reported_at': datetime.now().isoformat()
        }

        # Save to CSV
        if save_to_csv(report_data):
            return jsonify({
                'status': 'success',
                'message': 'Report submitted successfully',
                'report_id': report_data['id']
            })
        else:
            return jsonify({
                'status': 'error',
                'message': 'Failed to save report'
            }), 500

    except Exception as e:
        print(f"Error in report_incident: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

@report_routes.route('/get-reports', methods=['GET'])
def get_reports():
    try:
        reports = []
        if os.path.exists(REPORTS_FILE):
            with open(REPORTS_FILE, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                reports = list(reader)
        
        return jsonify({
            'status': 'success',
            'reports': reports
        })
    except Exception as e:
        print(f"Error getting reports: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500