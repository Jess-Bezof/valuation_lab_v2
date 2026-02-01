import os
from dotenv import load_dotenv
from google import genai

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    print("❌ Error: GEMINI_API_KEY is missing from .env file")
else:
    try:
        client = genai.Client(api_key=api_key)
        print("checking available models with NEW SDK...")
        # The new SDK might have a different way to list models.
        # client.models.list() returns an iterator.
        for m in client.models.list():
             print(f"✅ Available: {m.name}")
    except Exception as e:
        print(f"❌ Error listing models: {e}")