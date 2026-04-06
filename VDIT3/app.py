import streamlit as st
import google.generativeai as genai
from datetime import datetime
from fake_call import fake_call_page

# Configure page with custom theme
st.set_page_config(
    page_title="Women's Safety AI",
    page_icon="🛡️",
    layout="wide"
)

# Custom CSS
st.markdown("""
    <style>
    .main {
        background-color: #fdf2f7;
    }
    .stButton>button {
        background-color: #ff4b7d;
        color: white !important;
        border-radius: 20px;
        padding: 10px 25px;
        border: none;
        transition: all 0.3s ease;
    }
    .stButton>button:hover {
        background-color: #ff1a5e !important;
        color: white !important;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }
    .stButton>button:active {
        transform: translateY(0);
    }
    .emergency-box {
        background-color: #ffe4e8;
        padding: 20px;
        border-radius: 10px;
        border: 2px solid #ff4b7d;
    }
    .safety-tip {
        background-color: #fff3cd;
        padding: 20px;
        border-radius: 12px;
        margin: 15px 0;
        border-left: 5px solid #ff9800;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .safety-tip h4 {
        color: #ff4b7d;
        font-size: 1.2em;
        margin-bottom: 10px;
        font-weight: bold;
    }
    .safety-tip-text {
        color: #2c3e50;
        font-size: 1.1em;
        line-height: 1.5;
        font-weight: 500;
    }
    </style>
""", unsafe_allow_html=True)

# Configure API key
genai.configure(api_key="AIzaSyCWn-s64zRpZYsf5p6u1Z0pztC-VAsxpao")

# Initialize session state
if 'current_page' not in st.session_state:
    st.session_state.current_page = 'main'
if "messages" not in st.session_state:
    st.session_state.messages = []
if "safety_status" not in st.session_state:
    st.session_state.safety_status = "safe"

# Navigation
st.sidebar.title("Navigation")
page = st.sidebar.radio("Go to", ["Main Assistant", "Fake Call Generator"])

if page == "Fake Call Generator":
    fake_call_page()
else:
    # Main page content
    def safety_chatbot_response(prompt):
        model = genai.GenerativeModel("gemini-2.0-flash")
        formatted_prompt = f"""
        You are a Women's Safety Assistant providing **quick and practical safety advice**.
        Your responses should be **brief (under 3 sentences)** and offer **real-time safety tips, emergency actions, self-defense advice, or legal rights**.

        User: {prompt}
        Response: 
        """
        response = model.generate_content(formatted_prompt)
        return response.text.strip()

    # Header Section
    col1, col2, col3 = st.columns([1, 2, 1])
    with col2:
        st.title("Women's Safety AI 🛡️💬")

    # Emergency Resources Section
    st.sidebar.markdown("### 🚨 Emergency Resources")
    if st.sidebar.button("📞 Call Emergency (911)"):
        st.sidebar.error("In a real app, this would trigger an emergency call")
    if st.sidebar.button("🚔 Contact Local Police"):
        st.sidebar.warning("In a real app, this would connect to local police")

    # Safety Status Indicator
    st.sidebar.markdown("### 🔔 Your Safety Status")
    selected_status = st.sidebar.radio(
        "How are you feeling right now?",
        ["I feel safe", "I feel uncertain", "I need help"],
        help="Select your current safety status to get appropriate resources and guidance"
    )

    # Safety Status Response Section
    if selected_status == "I need help":
        st.sidebar.error("🚨 EMERGENCY MODE ACTIVATED")
        st.sidebar.markdown("""
            ### Immediate Actions:
            1. **Call Emergency Services**: 911
            2. **Share Your Location** with trusted contacts
            3. **Document Everything** happening around you
            
            ### Quick Resources:
            - **Emergency Hotline**: 1-800-799-SAFE
            - **Police Non-Emergency**: Local police contact
            - **Crisis Text Line**: Text HOME to 741741
        """)
        # Add emergency quick actions
        if st.sidebar.button("📞 CALL 911 NOW", key="emergency_call"):
            st.sidebar.error("Emergency call would be initiated (simulation)")
        if st.sidebar.button("📍 SHARE LOCATION", key="share_loc_emergency"):
            st.sidebar.error("Location sharing would be activated (simulation)")

    elif selected_status == "I feel uncertain":
        st.sidebar.warning("⚠️ ALERT MODE ACTIVATED")
        st.sidebar.markdown("""
            ### Recommended Actions:
            1. Stay aware of your surroundings
            2. Keep your phone ready
            3. Move to a well-lit/populated area
            
            ### Safety Tips:
            - Share your location with trusted contacts
            - Stay on a call with someone
            - Keep emergency numbers ready
        """)
        # Add precautionary actions
        if st.sidebar.button("👥 Contact Trusted Friend", key="contact_friend"):
            st.sidebar.info("Would initiate call to trusted contact (simulation)")
        if st.sidebar.button("🔊 Activate Silent Alarm", key="silent_alarm"):
            st.sidebar.warning("Silent alarm would be activated (simulation)")

    else:  # I feel safe
        st.sidebar.success("✅ SAFE STATUS CONFIRMED")
        st.sidebar.markdown("""
            ### Preventive Measures:
            1. Keep emergency contacts updated
            2. Review safety guidelines
            3. Stay prepared
            
            ### Safety Reminders:
            - Save important numbers
            - Plan safe routes
            - Stay connected
        """)
        # Add preventive actions
        if st.sidebar.button("📱 Update Emergency Contacts", key="update_contacts"):
            st.sidebar.success("Would open contacts manager (simulation)")
        if st.sidebar.button("🗺️ View Safe Routes", key="safe_routes"):
            st.sidebar.info("Would show nearby safe routes (simulation)")

    # Main Content Area
    col1, col2 = st.columns([2, 1])

    with col1:
        st.markdown("""
        ### Welcome to Your Personal Safety Assistant! 🌟
        This AI-powered tool is here to provide immediate guidance and support for your safety concerns.
        """)

        # Quick Action Buttons
        quick_actions = st.columns(3)
        with quick_actions[0]:
            if st.button("🏃‍♀️ Self Defense Tips"):
                user_message = "What are some quick self-defense moves?"
                st.session_state.messages.append({
                    "role": "user",
                    "content": user_message
                })
                with st.chat_message("user"):
                    st.markdown(user_message)
                with st.chat_message("assistant"):
                    with st.spinner("Generating self-defense tips..."):
                        response = safety_chatbot_response(user_message)
                        st.markdown(response)
                        st.session_state.messages.append({
                            "role": "assistant",
                            "content": response
                        })
        with quick_actions[1]:
            if st.button("🚗 Travel Safety"):
                user_message = "How to stay safe while traveling?"
                st.session_state.messages.append({
                    "role": "user",
                    "content": user_message
                })
                with st.chat_message("user"):
                    st.markdown(user_message)
                with st.chat_message("assistant"):
                    with st.spinner("Generating travel safety tips..."):
                        response = safety_chatbot_response(user_message)
                        st.markdown(response)
                        st.session_state.messages.append({
                            "role": "assistant",
                            "content": response
                        })
        with quick_actions[2]:
            if st.button("📱 Digital Safety"):
                user_message = "Tips for online safety?"
                st.session_state.messages.append({
                    "role": "user",
                    "content": user_message
                })
                with st.chat_message("user"):
                    st.markdown(user_message)
                with st.chat_message("assistant"):
                    with st.spinner("Generating digital safety tips..."):
                        response = safety_chatbot_response(user_message)
                        st.markdown(response)
                        st.session_state.messages.append({
                            "role": "assistant",
                            "content": response
                        })

    with col2:
        # Daily Safety Tip
        st.markdown("""
        <div class="safety-tip">
            <h4>�� Daily Safety Tip</h4>
            <div class="safety-tip-text">
                Trust your instincts! If a situation feels unsafe, it's okay to leave or seek help.
            </div>
        </div>
        """, unsafe_allow_html=True)

    # Chat Interface
    st.markdown("### 💭 Chat with Safety Assistant")
    for message in st.session_state.messages:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])

    # User input
    user_input = st.chat_input("Ask your safety-related question here...")

    # Clear chat button with confirmation
    col1, col2 = st.columns([6, 1])
    with col2:
        if st.button("🗑️ Clear Chat"):
            st.session_state.messages = []
            st.rerun()

    if user_input:
        st.session_state.messages.append({"role": "user", "content": user_input})
        with st.chat_message("user"):
            st.markdown(user_input)
        
        with st.chat_message("assistant"):
            with st.spinner("Processing your request..."):
                response = safety_chatbot_response(user_input)
                st.markdown(response)
                st.session_state.messages.append({"role": "assistant", "content": response})

    # Resources Section
    st.markdown("---")
    with st.expander("📚 Safety Resources & Hotlines"):
        col1, col2 = st.columns(2)
        with col1:
            st.markdown("""
            ### Emergency Numbers 📞
            - **Emergency**: 911
            - **Women's Helpline**: 1-800-799-SAFE
            - **Crisis Text Line**: Text HOME to 741741
            """)
        with col2:
            st.markdown("""
            ### Useful Links 🔗
            - [National Domestic Violence Hotline](https://www.thehotline.org/)
            - [RAINN - Anti-Sexual Violence](https://www.rainn.org/)
            - [Safety Planning Guide](https://www.womenslaw.org/)
            """)

    # Footer with timestamp
    st.markdown("---")
    st.markdown(f"*Last updated: {datetime.now().strftime('%Y-%m-%d %H:%M')} | Powered by Gemini AI - Your Personal Safety Guardian*")
