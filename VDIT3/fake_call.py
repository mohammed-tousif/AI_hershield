import streamlit as st
import pygame
import time
import os
from datetime import datetime

# Initialize pygame mixer for audio playback
pygame.mixer.init()

def load_audio_files():
    """Load available audio files from the audio directory"""
    audio_files = {}
    audio_dir = "audio"
    
    # Create audio directory if it doesn't exist
    if not os.path.exists(audio_dir):
        os.makedirs(audio_dir)
        st.warning("Please add .mp3 audio files to the 'audio' folder")
        return audio_files
    
    # Load all mp3 files from the audio directory
    for file in os.listdir(audio_dir):
        if file.endswith('.mp3'):
            name = file.replace('.mp3', '').replace('_', ' ').title()
            audio_files[name] = os.path.join(audio_dir, file)
    
    return audio_files

def play_audio(audio_file):
    """Play the selected audio file"""
    try:
        pygame.mixer.music.load(audio_file)
        pygame.mixer.music.play()
        while pygame.mixer.music.get_busy():
            time.sleep(1)
    except Exception as e:
        st.error(f"Error playing audio: {str(e)}")

def fake_call_page():
    st.title("📞 Fake Call Generator")
    
    # Custom CSS for better styling
    st.markdown("""
        <style>
        .fake-call-container {
            background-color: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin: 10px 0;
        }
        .call-button {
            background-color: #28a745;
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            border: none;
            width: 100%;
        }
        .emergency-note {
            background-color: #fff3cd;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #ffc107;
        }
        </style>
    """, unsafe_allow_html=True)

    # Information about the feature
    st.markdown("""
        ### 🔒 Safety Feature
        This fake call generator helps you create a believable excuse to leave uncomfortable situations.
        Choose a pre-recorded call type and timing to receive a realistic-looking incoming call.
    """)

    # Load available audio files
    audio_files = load_audio_files()

    if not audio_files:
        st.warning("""
            No audio files found! Please add .mp3 files to the 'audio' folder.
            Suggested audio types:
            - mom_call.mp3
            - friend_emergency.mp3
            - work_urgent.mp3
        """)
        return

    # Call Configuration
    st.markdown("### ⚙️ Configure Your Call")
    
    col1, col2 = st.columns(2)
    
    with col1:
        # Call type selection
        selected_call = st.selectbox(
            "Choose Call Type",
            list(audio_files.keys()),
            help="Select the type of fake call you want to receive"
        )

    with col2:
        # Delay selection
        delay_time = st.number_input(
            "Delay (seconds)",
            min_value=0,
            max_value=60,
            value=5,
            help="Set how many seconds to wait before the call starts"
        )

    # Caller information
    st.markdown("### 👤 Caller Display")
    caller_name = st.text_input(
        "Caller Name",
        value="Mom",
        help="This name will be displayed during the fake call"
    )

    # Call trigger button
    if st.button("📱 Generate Fake Call", key="generate_call"):
        with st.spinner(f"Call from {caller_name} incoming in {delay_time} seconds..."):
            # Display incoming call interface
            time.sleep(delay_time)
            
            # Create call interface
            call_container = st.empty()
            call_container.markdown(f"""
                <div class="fake-call-container">
                    <h3>📞 Incoming Call from {caller_name}</h3>
                    <p>⏰ {datetime.now().strftime('%H:%M')}</p>
                </div>
            """, unsafe_allow_html=True)
            
            # Play the selected audio
            audio_file = audio_files[selected_call]
            play_audio(audio_file)
            
            # Clear call interface after call ends
            time.sleep(2)
            call_container.empty()

    # Safety note
    st.markdown("""
        <div class="emergency-note">
            <h4>⚠️ Important Safety Note</h4>
            <p>While this feature can help you leave uncomfortable situations, always prioritize your safety:
            <ul>
                <li>Trust your instincts</li>
                <li>Don't hesitate to seek real help if needed</li>
                <li>Emergency services are always available at 911</li>
            </ul></p>
        </div>
    """, unsafe_allow_html=True)

    # Usage instructions
    with st.expander("📋 How to Use"):
        st.markdown("""
            1. **Choose a Call Type**: Select from pre-recorded call scenarios
            2. **Set Delay**: Choose how long to wait before the call starts
            3. **Enter Caller Name**: This will be displayed during the fake call
            4. **Click Generate**: The call will start after the selected delay
            5. **Act Natural**: When the call plays, you can pretend to answer and leave the situation
        """)

if __name__ == "__main__":
    fake_call_page() 