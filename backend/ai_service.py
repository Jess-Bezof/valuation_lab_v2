import logging
import os
import json
import re
import ast
import concurrent.futures
import dotenv
from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

# Load environment variables
dotenv.load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

def _safe_ticker(ticker: str) -> str:
    """Defense-in-depth: strip and cap ticker length before embedding in prompts."""
    return str(ticker).strip()[:10].upper()

def _sanitize_headlines(headlines: list, max_items: int = 10, max_title_len: int = 200) -> list:
    """Cap headline count and individual title length to limit prompt manipulation."""
    result = []
    for item in headlines[:max_items]:
        safe = dict(item)
        if safe.get("title"):
            safe["title"] = str(safe["title"])[:max_title_len]
        result.append(safe)
    return result

# temperature=0 makes all structured-JSON responses deterministic.
# At non-zero temperature the model samples different tokens each call,
# producing different numeric values for the same company — exactly the
# instability the user reported for valuation adjustments.
_DETERMINISTIC = genai_types.GenerateContentConfig(temperature=0.0)

# Initialize the NEW client
client = None
if api_key:
    try:
        client = genai.Client(api_key=api_key)
    except Exception as e:
        logger.error("Failed to initialize Gemini Client: %s", e)

def get_competitors_from_ai(ticker, company_name):
    current_model = 'gemini-2.5-flash'
    ticker = _safe_ticker(ticker)
    company_name = str(company_name).strip()[:100]

    logger.info("Getting competitors via AI for %s using %s", ticker, current_model)

    if not client:
        logger.error("Gemini client not initialized — API key missing")
        return []

    try:
        # We ask for JSON, but we will handle Python lists too
        prompt = (
            f"Return a strict list of 5 ticker symbols for the top public competitors of {company_name} ({ticker}). "
            f"Format: ['TICKER1', 'TICKER2', ...]. No text, no markdown, just the list."
        )

        response = client.models.generate_content(
            model=current_model, contents=prompt, config=_DETERMINISTIC
        )
        text = response.text

        # 1. Clean up markdown (```json ... ```)
        text = re.sub(r"```json", "", text)
        text = re.sub(r"```python", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        logger.debug("AI competitor response for %s: %s", ticker, text)

        # 2. Try Standard JSON Parse (Double Quotes)
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            # 3. Fallback: Try Python Literal Parse (Single Quotes)
            try:
                return ast.literal_eval(text)
            except Exception:
                logger.error("Could not parse AI competitor response for %s: %s", ticker, text)
                return []

    except Exception as e:
        logger.error("AI model %s failed for %s: %s", current_model, ticker, e)
        return []

def get_major_events_from_ai(ticker, news_data):
    current_model = 'gemini-2.5-flash'
    ticker = _safe_ticker(ticker)
    logger.info("Analyzing news events for %s", ticker)

    if not client:
        return []

    try:
        news_summary = json.dumps(_sanitize_headlines(news_data)) 
        
        prompt = (
            f"Analyze the following news headlines for {ticker} and identify the top 5 most significant events. "
            f"Return a strict JSON list of objects with keys: 'time' (YYYY-MM-DD), 'title', 'summary', and 'sentiment' (positive, negative, or neutral). "
            f"If the news item has a timestamp, use it. If not, use today's date. "
            f"News Data: {news_summary} "
            f"Strict JSON format only. No markdown."
        )

        response = client.models.generate_content(
            model=current_model, contents=prompt, config=_DETERMINISTIC
        )
        text = response.text

        # Clean up markdown
        text = re.sub(r"```json", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        try:
            return json.loads(text)
        except Exception:
            return []

    except Exception as e:
        logger.error("AI news analysis failed for %s: %s", ticker, e)
        return []

def analyze_price_shock(ticker, date_str, percent_change, headlines, end_date_str=None):
    current_model = 'gemini-2.5-flash'
    ticker = _safe_ticker(ticker)
    headlines = _sanitize_headlines(headlines)

    if not client:
        return {
            'headline': 'AI Unavailable',
            'summary': 'API Key missing',
            'sentiment': 'neutral'
        }
    
    period_msg = f"on {date_str}"
    if end_date_str:
        period_msg = f"from {date_str} to {end_date_str}"
        
    logger.info("Analyzing price move for %s %s (%.2f%%)", ticker, period_msg, percent_change)

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
            model=current_model, contents=prompt, config=_DETERMINISTIC
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
                
            logger.info("Gemini summary for %s: %s...", ticker, summary[:50])
            return data

        except json.JSONDecodeError:
            logger.warning("Gemini returned non-JSON for %s: %s...", ticker, text[:50])
            return {
                'headline': 'AI Analysis',
                'summary': text if text else 'No detailed AI summary available for this event',
                'sentiment': 'neutral'
            }

    except Exception as e:
        logger.error("AI shock analysis failed for %s: %s", ticker, e)
        return {
            'headline': 'AI Analysis Failed',
            'summary': 'No detailed AI summary available for this event',
            'sentiment': 'neutral'
        }

def get_valuation_adjustments(ticker: str, financials_context: dict) -> dict | None:
    """
    Call Gemini to produce Damodaran-style normalized valuation inputs.

    Returns a dict with companyType, cyclicality, moatStrength, adjustments
    (revenueGrowth + targetOperatingMargin), overallConfidence, and summary.
    Returns None on any failure so callers can fall back to mechanical rules.
    """
    current_model = 'gemini-2.5-flash'
    ticker = _safe_ticker(ticker)

    if not client:
        logger.warning("Gemini client not initialized; skipping valuation adjustments for %s", ticker)
        return None

    raw_growth = financials_context.get('rawRevenueGrowth', 0.05)
    raw_margin = financials_context.get('rawOperatingMargin', 0.15)
    raw_roic   = financials_context.get('roic', 0.15)

    def _call_gemini():
        context_str = json.dumps(financials_context)[:3000]
        prompt = (
            f"You are a senior equity analyst applying Damodaran's valuation framework to {ticker}.\n"
            f"Company data: {context_str}\n\n"
            f"Task:\n"
            f"1. Classify the company. Choose companyType from: platform_semiconductor, cyclical_commodity, "
            f"consumer_staple, platform_software, financial_services, capital_intensive_manufacturer, "
            f"biotech, retail, telecom, or another concise label. "
            f"Set cyclicality to 'high', 'medium', or 'low'. "
            f"Set moatStrength to 'strong', 'moderate', or 'weak'.\n"
            f"2. Assess whether the raw 3-year revenue CAGR of {raw_growth:.1%} is cyclically inflated, depressed, "
            f"or representative. Provide a normalized 5-year forward growth rate and explain why "
            f"(reference TAM, competitive dynamics, and cycle position). "
            f"Keep value between 0.02 and 0.50.\n"
            f"3. Assess whether the current operating margin of {raw_margin:.1%} is peak, trough, or mid-cycle. "
            f"Provide a normalized target margin at the end of the DCF horizon and explain why "
            f"(consider competition, pricing power, cost structure). "
            f"Keep value between 0.01 and 0.60.\n"
            f"4. Estimate the company's forward incremental ROIC — the return earned on each new dollar invested "
            f"to fund future growth. The historical accounting ROIC is {raw_roic:.1%}. "
            f"For asset-light businesses (software, platforms, marketplaces) incremental ROIC is typically "
            f"much higher than accounting ROIC (0.40–1.50). For capital-intensive businesses "
            f"(manufacturers, utilities, miners) it may be close to or below accounting ROIC (0.05–0.20). "
            f"Provide a normalized incremental ROIC and explain why (consider business model, capex intensity, "
            f"pricing power, and network effects). Keep value between 0.05 and 2.00.\n"
            f"5. Write a 1-sentence summary of the key normalization insight.\n\n"
            f"Return ONLY this JSON structure (no markdown, no extra keys):\n"
            f'{{"companyType":"...","cyclicality":"high|medium|low","moatStrength":"strong|moderate|weak",'
            f'"adjustments":{{"revenueGrowth":{{"value":0.0,"reasoning":"<120 chars","confidence":"high|medium|low"}},'
            f'"targetOperatingMargin":{{"value":0.0,"reasoning":"<120 chars","confidence":"high|medium|low"}},'
            f'"roic":{{"value":0.0,"reasoning":"<120 chars","confidence":"high|medium|low"}}}},'
            f'"overallConfidence":"high|medium|low","summary":"..."}}'
        )
        response = client.models.generate_content(
            model=current_model, contents=prompt, config=_DETERMINISTIC
        )
        return response.text

    try:
        with concurrent.futures.ThreadPoolExecutor() as executor:
            future = executor.submit(_call_gemini)
            text = future.result(timeout=20)

        text = re.sub(r"```json", "", text)
        text = re.sub(r"```", "", text)
        text = text.strip()

        data = json.loads(text)

        if 'adjustments' not in data:
            logger.warning("AI valuation adjustments missing 'adjustments' key for %s", ticker)
            return None

        # Pin rawValue from the context we know — don't trust AI to echo it correctly.
        adj = data['adjustments']
        if 'revenueGrowth' in adj:
            adj['revenueGrowth']['rawValue'] = raw_growth
        if 'targetOperatingMargin' in adj:
            adj['targetOperatingMargin']['rawValue'] = raw_margin
        if 'roic' in adj:
            adj['roic']['rawValue'] = raw_roic

        # Clamp AI values to safe ranges
        if 'revenueGrowth' in adj:
            adj['revenueGrowth']['value'] = max(0.02, min(0.50, float(adj['revenueGrowth']['value'])))
        if 'targetOperatingMargin' in adj:
            adj['targetOperatingMargin']['value'] = max(0.01, min(0.60, float(adj['targetOperatingMargin']['value'])))
        if 'roic' in adj:
            adj['roic']['value'] = max(0.05, min(2.00, float(adj['roic']['value'])))

        logger.info(
            "AI valuation adjustments for %s: type=%s growth=%.1f%%→%.1f%% margin=%.1f%%→%.1f%% roic=%.1f%%→%.1f%%",
            ticker,
            data.get('companyType', '?'),
            raw_growth * 100,
            adj.get('revenueGrowth', {}).get('value', raw_growth) * 100,
            raw_margin * 100,
            adj.get('targetOperatingMargin', {}).get('value', raw_margin) * 100,
            raw_roic * 100,
            adj.get('roic', {}).get('value', raw_roic) * 100,
        )
        return data

    except concurrent.futures.TimeoutError:
        logger.warning("AI valuation adjustments timed out for %s", ticker)
        return None
    except json.JSONDecodeError as e:
        logger.error("Could not parse AI valuation adjustments for %s: %s", ticker, e)
        return None
    except Exception as e:
        logger.error("AI valuation adjustments failed for %s: %s", ticker, e)
        return None


def generate_fundamental_analysis(ticker, financial_context):
    current_model = 'gemini-2.5-flash'
    ticker = _safe_ticker(ticker)
    logger.info("Analyzing fundamentals for %s", ticker)

    if not client:
        return {}

    def _call_gemini():
        context_str = json.dumps(financial_context)[:8000]
        prompt = (
            f"You are a Senior Equity Research Analyst covering {ticker}. "
            f"Generate a professional research report analyzing the company's valuation, growth drivers, and risks. "
            f"Data Context: {context_str}. "
            f"Structure your response as a strict JSON object with these 4 keys: "
            f"1. 'companyDescription': A 1-2 sentence high-level summary of the business model and primary revenue streams. "
            f"2. 'valuationStory': A concise paragraph analyzing the current valuation. Compare metrics to historical averages or peers if implied. Avoid generic definitions. "
            f"3. 'keyDrivers': A bulleted list (string with newlines) of 3 distinct catalysts (internal or external) driving the stock. Specifically mention Internal Catalysts (product lines, margins) and External Factors (macro, regulation). "
            f"4. 'riskFactors': A bulleted list (string with newlines) of 3 specific risks unique to this company/industry. "
            f"Strict JSON only. No markdown."
        )
        response = client.models.generate_content(
            model=current_model, contents=prompt, config=_DETERMINISTIC
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
            logger.error("Could not parse fundamental AI response for %s: %s", ticker, text)
            return {}

    except concurrent.futures.TimeoutError:
        logger.error("Fundamental analysis timed out for %s", ticker)
        return {
            "valuationStory": "AI Analysis Timed Out. Summary currently unavailable.",
            "companyDescription": f"{ticker} data available, but AI report generation timed out.",
            "keyDrivers": "• AI Service Timeout\n• Try refreshing in a few moments",
            "riskFactors": "• AI Service Timeout"
        }
    except Exception as e:
        logger.error("AI fundamental analysis failed for %s: %s", ticker, e)
        return {}
