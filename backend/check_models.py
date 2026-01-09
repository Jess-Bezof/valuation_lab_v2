from google import genai
import os
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ Error: GEMINI_API_KEY is missing from .env file")
else:
    client = genai.Client(api_key=api_key)
    print("checking available models...")
    try:
        for m in client.models:
            if 'generateContent' in m.supported_generation_methods:
                print(f"✅ Available: {m.name}")
    except Exception as e:
        print(f"❌ Error listing models: {e}")