import google.generativeai as genai

# Configure API key
genai.configure(api_key="AIzaSyCWn-s64zRpZYsf5p6u1Z0pztC-VAsxpao")  

def safety_chatbot(prompt):
    model = genai.GenerativeModel("gemini-2.0-flash")
    
    # Ensure responses are safety-focused and actionable
    formatted_prompt = f"""
    You are a Women's Safety Assistant providing **quick and practical safety advice**.
    Your responses should be **brief (under 3 sentences)** and offer **real-time safety tips, emergency actions, self-defense advice, or legal rights**.

    User: {prompt}
    Response: 
    """

    response = model.generate_content(formatted_prompt)
    return response.text

# Chat loop
while True:
    user_input = input("You: ")
    if user_input.lower() == "exit":
        break
    print("Safety Assistant:", safety_chatbot(user_input))
