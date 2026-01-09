import google.generativeai as genai
# Reverting to google.generativeai because 'google-genai' package might not be installed or compatible in this specific environment yet. 
# The user asked to use 'from google import genai' but if that causes issues, we should stick to what works or ensure it's correct.
# Actually, the user specifically said "Refactor ... to use the newly installed google-genai library".
# So I MUST use `from google import genai`.

from google import genai
from google.genai import types
import concurrent.futures
import os
import json
import re
import ast
import dotenv

# Load environment variables
dotenv.load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

client = None
if api_key:
    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        print(f"Failed to initialize Gemini Client: {e}")

def get_competitors_from_ai(ticker, company_name):
    current_model = 'gemini-2.0-flash-exp'
    
    print(f"🤖 AI Service: Using model {current_model} for {ticker}...")

    if not client:
        print("❌ Gemini API Key missing or client not initialized.")
        return []

    try:
        # We ask for JSON, but we will handle Python lists too
        prompt = (
            f"Return a strict list of 5 ticker symbols for the top public competitors of {company_name} ({ticker}). "
            f"Format: ['TICKER1', 'TICKER2', ...]. No text, no markdown, just the list."
        )

        response = client.models.generate_content(
            model=current_model, contents=prompt
        )
        text = response.text

        # 1. Clean up markdown (```json ... ```)
        text = re.sub(r"```json", "", text)
        text = re.sub(r"```python", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        print(f"🤖 AI Response: {text}")

        # 2. Try Standard JSON Parse (Double Quotes)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # 3. Fallback: Try Python Literal Parse (Single Quotes)
            try:
                return ast.literal_eval(text)
            except Exception:
                print(f"❌ Could not parse AI response: {text}")
                return []

    except Exception as e:
        print(f"❌ Primary AI Model ({current_model}) failed: {e}")
        return []

def get_major_events_from_ai(ticker, news_data):
    current_model = 'gemini-2.0-flash-exp'
    print(f"🤖 AI Service: Analyzing news for {ticker}...")

    if not client:
        return []

    try:
        # Limit news data to avoid token limits
        news_summary = json.dumps(news_data[:10]) 
        
        prompt = (
            f"Analyze the following news headlines for {ticker} and identify the top 5 most significant events. "
            f"Return a strict JSON list of objects with keys: 'time' (YYYY-MM-DD), 'title', 'summary', and 'sentiment' (positive, negative, or neutral). "
            f"If the news item has a timestamp, use it. If not, use today's date. "
            f"News Data: {news_summary} "
            f"Strict JSON format only. No markdown."
        )

        response = client.models.generate_content(
            model=current_model, contents=prompt
        )
        text = response.text

        # Clean up markdown
        text = re.sub(r"```json", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        try:
            return json.loads(text)
        except:
            return []

    except Exception as e:
        print(f"❌ AI News Analysis failed: {e}")
        return []

def analyze_price_shock(ticker, date_str, percent_change, headlines, end_date_str=None):
    """
    Uses Gemini to identify which news headline explains a significant price move.
    """
    current_model = 'gemini-2.0-flash-exp'
    
    if not client:
        return {
            'headline': 'AI Unavailable',
            'summary': 'API Key missing',
            'sentiment': 'neutral'
        }
    
    period_msg = f"on {date_str}"
    if end_date_str:
        period_msg = f"from {date_str} to {end_date_str}"
        
    print(f"🤖 AI Service: Analyzing price move for {ticker} {period_msg} ({percent_change}%)")

    try:
        move_type = "jumped" if percent_change > 0 else "dropped"
        
        prompt = (
            f"You are a Financial News Gatekeeper for ticker {ticker}. Your goal is to find the PRIMARY reason for a {percent_change}% price move {period_msg}. "
            f"Here is the news for the 10 days leading up to a major price reversal on {date_str}. "
            f"Identify if the reversal was caused by a single 'Flash Event' on the pivot day, or if it was the culmination of a 'Slow Build' story (like a series of rumors) over the preceding week. "
            f"Headlines: {json.dumps(headlines)}. "
            f"Rule 1: Reject any news where {ticker} is just a side-mention or part of a list (e.g., 'Stocks to watch today'). "
            f"Rule 2: Reject news that is about a competitor unless it directly changes the valuation of {ticker} (e.g., a massive contract win by a rival). "
            f"Rule 3: If no specific company news exists, provide a brief 'Market Sentiment' summary (e.g., 'Broad sector rally' or 'Technical rebound') in the 'summary' field and set 'headline' to 'Market Sentiment'. Do NOT return 'NONE' in this case. "
            f"Output: A strict JSON object with keys: "
            f"'is_relevant' (boolean, true if company news OR market sentiment found), "
            f"'headline' (the exact text of the chosen headline or 'Market Sentiment'), "
            f"'summary' (a single summary sentence explaining why this caused the move), "
            f"and 'sentiment' (positive/negative/neutral). "
            f"Strict JSON only. No markdown."
        )

        response = client.models.generate_content(
            model=current_model, contents=prompt
        )
        text = response.text
        
        # Strip accidental whitespace
        text = text.strip()

        # Clean up markdown
        text = re.sub(r"```json", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        try:
            data = json.loads(text)
            
            # Ensure summary is not empty
            summary = data.get('summary', '').strip()
            if not summary:
                summary = 'No detailed AI summary available for this event'
                data['summary'] = summary
                
            print(f"✅ Gemini Summary: {summary[:50]}...")
            return data
            
        except json.JSONDecodeError:
            print(f"⚠️ Gemini returned non-JSON: {text[:50]}...")
            return {
                'headline': 'AI Analysis',
                'summary': text if text else 'No detailed AI summary available for this event',
                'sentiment': 'neutral'
            }

    except Exception as e:
        print(f"❌ AI Shock Analysis failed: {e}")
        return {
            'headline': 'AI Analysis Failed',
            'summary': 'No detailed AI summary available for this event',
            'sentiment': 'neutral'
        }

def generate_fundamental_analysis(ticker, financial_context):
    current_model = 'gemini-2.0-flash-exp'
    print(f"🤖 AI Service: Analyzing fundamentals for {ticker}...")
    
    if not client:
        return {}

    def _call_gemini():
        prompt = (
            f"You are a Senior Equity Research Analyst covering {ticker}. "
            f"Generate a professional research report analyzing the company's valuation, growth drivers, and risks. "
            f"Data Context: {json.dumps(financial_context)}. "
            f"Structure your response as a strict JSON object with these 4 keys: "
            f"1. 'companyDescription': A 1-2 sentence high-level summary of the business model and primary revenue streams. "
            f"2. 'valuationStory': A concise paragraph analyzing the current valuation. Compare metrics to historical averages or peers if implied. Avoid generic definitions. "
            f"3. 'keyDrivers': A bulleted list (string with newlines) of 3 distinct catalysts (internal or external) driving the stock. Specifically mention Internal Catalysts (product lines, margins) and External Factors (macro, regulation). "
            f"4. 'riskFactors': A bulleted list (string with newlines) of 3 specific risks unique to this company/industry. "
            f"Strict JSON only. No markdown."
        )
        response = client.models.generate_content(
            model=current_model, contents=prompt
        )
        return response.text

    try:
        # Enforce 25-second timeout for AI
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(_call_gemini)
            text = future.result(timeout=25)

        # Clean up markdown
        text = re.sub(r"```json", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            print(f"❌ Could not parse AI response: {text}")
            return {}

    except concurrent.futures.TimeoutError:
        print(f"❌ AI Timeout: Fundamental analysis took too long for {ticker}")
        return {
            "valuationStory": "AI Analysis Timed Out. Summary currently unavailable.",
            "companyDescription": f"{ticker} data available, but AI report generation timed out.",
            "keyDrivers": "• AI Service Timeout\n• Try refreshing in a few moments",
            "riskFactors": "• AI Service Timeout"
        }
    except Exception as e:
        print(f"❌ AI Fundamental Analysis failed: {e}")
        return {}
