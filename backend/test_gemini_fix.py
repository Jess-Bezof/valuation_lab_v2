import os
import sys
from dotenv import load_dotenv

# Ensure we can import from current directory
sys.path.append(os.getcwd())

from ai_service import analyze_price_shock, get_competitors_from_ai

def test_gemini_connection():
    print("🧪 Testing Gemini 2.0 Flash Connection...")
    
    # Test 1: Simple Competitor Check
    print("\n--- Test 1: Competitor Check (Simple) ---")
    competitors = get_competitors_from_ai("AAPL", "Apple Inc.")
    print(f"Result: {competitors}")
    if competitors and len(competitors) > 0:
        print("✅ Competitor check PASSED")
    else:
        print("❌ Competitor check FAILED")

    # Test 2: Price Shock Analysis (The one that was failing)
    print("\n--- Test 2: Price Shock Analysis (Complex) ---")
    dummy_news = [
        {"title": "Apple releases new iPhone 16 with AI features", "time_published": "2024-09-10"},
        {"title": "Tech stocks rally on lower interest rate hopes", "time_published": "2024-09-10"}
    ]
    
    result = analyze_price_shock("AAPL", "2024-09-10", 5.2, dummy_news)
    print(f"Result: {result}")
    
    if result.get('headline') != 'AI Analysis Failed':
        print("✅ Price Shock Analysis PASSED")
    else:
        print("❌ Price Shock Analysis FAILED")

if __name__ == "__main__":
    test_gemini_connection()