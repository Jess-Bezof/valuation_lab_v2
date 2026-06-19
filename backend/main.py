import logging
import re
import time
from pathlib import Path
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from stock_data import get_real_data, get_metric_details, get_stock_history, search_ticker
from ai_service import analyze_price_shock, get_valuation_adjustments
from dotenv import load_dotenv
import os
import requests
import json
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Load backend/.env and override stale machine-level env vars (e.g. production ALLOWED_ORIGINS).
_BACKEND_DIR = Path(__file__).resolve().parent
load_dotenv(_BACKEND_DIR / ".env", override=True)

def _check_env_vars():
    if not os.getenv("GEMINI_API_KEY"):
        logger.warning("GEMINI_API_KEY not set — AI analysis will be unavailable")
    if not os.getenv("ALPHA_VANTAGE_API_KEY") and not os.getenv("MARKETAUX_API_TOKEN"):
        logger.warning("No news API keys set — news markers will use mock data")

_check_env_vars()

app = FastAPI()

# CORS must be registered early so all routes (including /health) get correct preflight headers.
_DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"
_raw_origins = os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS)
CORS_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
logger.info("CORS allow_origins: %s", CORS_ORIGINS)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS", "HEAD", "PATCH"],
    allow_headers=["*"],
)

# Ticker format: 1–5 letters, optionally followed by . or - and 1–2 letters (e.g. BRK.B)
_TICKER_RE = re.compile(r'^[A-Z]{1,5}([.\-][A-Z]{1,2})?$')
_SEARCH_RE = re.compile(r'^[A-Za-z0-9 .\-&]+$')

def _validate_ticker(ticker: str) -> str:
    cleaned = ticker.upper().strip()
    if not _TICKER_RE.match(cleaned):
        raise HTTPException(status_code=422, detail=f"Invalid ticker '{ticker}'. Expected 1–5 letters (e.g. AAPL, BRK.B).")
    return cleaned

def _validate_search_query(query: str) -> str:
    query = query.strip()
    if len(query) > 50:
        raise HTTPException(status_code=422, detail="Search query too long (max 50 characters).")
    if not _SEARCH_RE.match(query):
        raise HTTPException(status_code=422, detail="Search query contains invalid characters.")
    return query

# This ensures it's one of the first routes the server "knows"
@app.get("/health")
async def health_check():
    return {
        "status": "healthy", 
        "server_time": datetime.now().isoformat(),
        "environment": "production"
    }

CACHE_FILE = "news_cache.json"
# SEC REQUIRES a User-Agent with an email address
_SEC_EMAIL = os.getenv("SEC_CONTACT_EMAIL", "mit-student-project@mit.edu")
SEC_HEADERS = {'User-Agent': _SEC_EMAIL}

# Canonical XBRL tag → list of alternative tags tried in priority order when the
# canonical tag is absent from a company's filing.  Covers the most common
# variations across US-GAAP filers (ASC 606 migration, banking vs non-banking, etc.)
TAG_ALIASES: dict[str, list[str]] = {
    'Revenues': [
        'RevenueFromContractWithCustomerExcludingAssessedTax',
        'RevenueFromContractWithCustomerIncludingAssessedTax',
        'SalesRevenueNet',
        'SalesRevenueGoodsNet',
        'SalesRevenueServicesNet',
        'InterestAndDividendIncomeOperating',    # banks
    ],
    'GrossProfit': [
        'GrossProfitLoss',
    ],
    'OperatingIncomeLoss': [
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
        'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments',
    ],
    'NetIncomeLoss': [
        'NetIncomeLossAvailableToCommonStockholdersBasic',
        'ProfitLoss',
        'IncomeLossFromContinuingOperations',
        'NetIncomeLossAttributableToParent',
    ],
    'CashAndCashEquivalentsAtCarryingValue': [
        'CashCashEquivalentsAndShortTermInvestments',
        'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents',
        'CashAndDueFromBanks',
    ],
    'LongTermDebt': [
        'LongTermDebtNoncurrent',
        'LongTermDebtAndCapitalLeaseObligations',
        'LongTermNotesPayable',
        'SeniorLongTermNotes',
    ],
    'RetainedEarnings': [
        'RetainedEarningsAccumulatedDeficit',
    ],
    'StockholdersEquity': [
        'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
        'PartnersCapital',
    ],
    'OperatingExpenses': [
        'CostsAndExpenses',
        'OperatingCostsAndExpenses',
    ],
    'ResearchAndDevelopmentExpense': [
        'ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost',
    ],
}

# --- SEC EDGAR ENGINE ---
class SECEngine:
    """
    Direct interface with SEC EDGAR to reconstruct 10 years of 
    Income Statements and Balance Sheets for Phase 1 Graham Audit.
    """
    def __init__(self, ticker):
        self.ticker = ticker.upper()

    def get_cik(self):
        url = "https://www.sec.gov/files/company_tickers.json"
        try:
            res = requests.get(url, headers=SEC_HEADERS)
            data = res.json()
            for entry in data.values():
                if entry['ticker'] == self.ticker:
                    # CIK must be 10 digits padded with zeros
                    return str(entry['cik_str']).zfill(10)
        except Exception as e:
            logger.error("CIK Mapping Error: %s", e)
        return None

    def get_full_financials(self):
        cik = self.get_cik()
        if not cik: return None

        url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
        try:
            res = requests.get(url, headers=SEC_HEADERS)
            if res.status_code != 200:
                return None
            
            data = res.json()
            us_gaap = data['facts'].get('us-gaap', {})

            # ------------------------------------------------------------------
            # Phase 1: Full Statement Reconstruction (10-K only)
            # ------------------------------------------------------------------
            
            reconstructed_statements = {}
            # Tracks the most recently filed date per (fiscal_year, tag) to deduplicate
            # restated or amended 10-K filings — later filing wins.
            filed_tracker = {}

            # Iterate through ALL available US-GAAP tags in the response
            for tag, tag_data in us_gaap.items():
                label = tag_data.get('label', tag)
                description = tag_data.get('description', 'No description available')

                units = tag_data.get('units', {})
                for unit_type, entries in units.items():
                    # Only store USD-denominated values. Skipping 'shares', 'pure',
                    # 'USD/shares', etc. prevents dollar and count values from
                    # colliding under the same tag key.
                    if unit_type != 'USD':
                        continue

                    for entry in entries:
                        # STRICT FILTER: Only 10-K (Annual)
                        if entry.get('form') != '10-K':
                            continue

                        # Skip quarterly sub-periods that can appear inside a 10-K
                        # (e.g. comparative quarterly disclosure).  Allow missing fp.
                        fp = entry.get('fp')
                        if fp and fp != 'FY':
                            continue

                        end_date = entry['end']
                        val = entry['val']
                        filed = entry.get('filed', '')

                        # Use the 'fy' field if available, otherwise fall back to the
                        # year of the period-end date.
                        fiscal_year = str(entry.get('fy', end_date[:4]))

                        if fiscal_year not in reconstructed_statements:
                            reconstructed_statements[fiscal_year] = {
                                "year": fiscal_year,
                                "date": end_date,
                                "metadata": {}
                            }
                        if fiscal_year not in filed_tracker:
                            filed_tracker[fiscal_year] = {}

                        # Keep the value from the most recently filed 10-K for this
                        # tag/year pair. This prefers restated/amended filings over
                        # the original when both exist.
                        if filed >= filed_tracker[fiscal_year].get(tag, ''):
                            reconstructed_statements[fiscal_year][tag] = val
                            filed_tracker[fiscal_year][tag] = filed

                        if tag not in reconstructed_statements[fiscal_year]['metadata']:
                            reconstructed_statements[fiscal_year]['metadata'][tag] = {
                                "label": label,
                                "desc": description
                            }

            # ------------------------------------------------------------------
            # Phase 1b: Alias Resolution
            # For each year, if a canonical tag is missing, fill it from the
            # first matching alternative tag (in TAG_ALIASES priority order).
            # ------------------------------------------------------------------
            for year_dict in reconstructed_statements.values():
                for canonical, alternatives in TAG_ALIASES.items():
                    if canonical not in year_dict:
                        for alt in alternatives:
                            if alt in year_dict:
                                year_dict[canonical] = year_dict[alt]
                                break

            # ------------------------------------------------------------------
            # Phase 2: Sort and Slice (Last 10 Years)
            # ------------------------------------------------------------------
            
            sorted_years = sorted(
                list(reconstructed_statements.values()),
                key=lambda x: x['year'], 
                reverse=True
            )

            # Return the massive object
            return {
                "ticker": self.ticker,
                "cik": cik,
                "financials": sorted_years[:10] # Top 10 most recent years
            }

        except Exception as e:
            logger.error("SEC Data Extraction Error: %s", e)
            return None

def load_cache():
    if not os.path.exists(CACHE_FILE):
        return {}
    try:
        with open(CACHE_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {}

def save_cache(cache_data):
    try:
        with open(CACHE_FILE, 'w') as f:
            json.dump(cache_data, f, indent=4)
    except Exception as e:
        logger.error("Error saving cache: %s", e)

def get_stock_news(symbol: str, history_data: list = None):
    marketaux_token = os.getenv("MARKETAUX_API_TOKEN")
    alpha_vantage_key = os.getenv("ALPHA_VANTAGE_API_KEY")
    
    mock_markers = [
        {"time": "2025-12-20", "text": "Mock: Positive Earnings Surprise", "label": "N", "color": "#22c55e", "shape": "circle", "position": "belowBar", "headline": "Mock Headline"},
        {"time": "2025-12-15", "text": "Mock: CEO Keynote Speech", "label": "N", "color": "#fbbf24", "shape": "circle", "position": "aboveBar", "headline": "Mock Headline"}
    ]

    if not marketaux_token and not alpha_vantage_key:
        logger.warning("No News API Tokens found. Using Mock Markers.")
        return mock_markers

    if not history_data or len(history_data) < 2:
        return []

    # Safe check for history_data content (NoneType Fix)
    if history_data is None:
        return []

    shocks = []
    shock_tasks = [] # Collect tasks for parallel execution
    cutoff_date = datetime.now() - timedelta(days=730)
    sorted_history = sorted(history_data, key=lambda x: x['time'])
    
    i = 14
    while i < len(sorted_history):
        current_data = sorted_history[i]
        past_data = sorted_history[i-14]
        
        date_str = current_data['time']
        
        try:
            current_date_obj = datetime.strptime(date_str, "%Y-%m-%d")
            if current_date_obj < cutoff_date:
                i += 1
                continue
        except ValueError:
            i += 1
            continue

        curr_price = current_data['value']
        past_price = past_data['value']
        
        if past_price == 0: 
            i += 1
            continue
            
        cum_return = (curr_price - past_price) / past_price
        
        if abs(cum_return) >= 0.05:
            lookback_start_idx = max(0, i - 10)
            lookback_slice = sorted_history[lookback_start_idx : i+1]
            
            pivot_day = None
            if cum_return > 0:
                pivot_day = min(lookback_slice, key=lambda x: x['value'])
            else:
                pivot_day = max(lookback_slice, key=lambda x: x['value'])
            
            if pivot_day:
                pivot_date_obj = datetime.strptime(pivot_day['time'], "%Y-%m-%d")
                start_news_date = (pivot_date_obj - timedelta(days=1)).strftime("%Y-%m-%d")
                end_news_date = (pivot_date_obj + timedelta(days=1)).strftime("%Y-%m-%d")
                
                shocks.append({
                    "date": pivot_day['time'],
                    "change": round(cum_return * 100, 2), 
                    "value": pivot_day['value'],
                    "start_date": start_news_date,
                    "end_date": end_news_date 
                })
            i += 14
        else:
            i += 1

    shocks.sort(key=lambda x: abs(x['change']), reverse=True)
    top_shocks = shocks[:5]
    top_shocks.sort(key=lambda x: x['date'], reverse=True)
    
    markers = []
    existing_dates = []

    for shock in top_shocks:
        shock_date_str = shock['date'] 
        
        shock_dt = datetime.strptime(shock_date_str, "%Y-%m-%d")
        is_too_close = False
        for existing_date_str in existing_dates:
            existing_dt = datetime.strptime(existing_date_str, "%Y-%m-%d")
            if abs((shock_dt - existing_dt).days) <= 3:
                is_too_close = True
                break
        
        if is_too_close: continue
            
        news_list = []
        source_used = "None"
        
        pivot_dt = datetime.strptime(shock_date_str, "%Y-%m-%d")
        search_start_str = (pivot_dt - timedelta(days=10)).strftime("%Y-%m-%d")
        search_end_str = (pivot_dt + timedelta(days=4)).strftime("%Y-%m-%d")

        if marketaux_token:
            url_ma = f"https://api.marketaux.com/v1/news/all?symbols={symbol}&filter_entities=true&published_after={search_start_str}T00:00&published_before={search_end_str}T23:59&api_token={marketaux_token}"
            try:
                response = requests.get(url_ma)
                if response.status_code == 200:
                    data = response.json()
                    if "data" in data:
                        for item in data["data"]:
                            is_relevant = False
                            match_score = 0
                            for entity in item.get('entities', []):
                                if entity.get('symbol') == symbol:
                                    score = entity.get('match_score', 0)
                                    if score > 0.7:
                                        is_relevant = True
                                        match_score = score
                                        break
                            if is_relevant:
                                news_list.append({
                                    "title": item.get("title"),
                                    "source": item.get("source"),
                                    "url": item.get("url"),
                                    "date": item.get("published_at"),
                                    "relevance_score": match_score
                                })
                elif response.status_code == 429:
                    logger.warning("Marketaux Quota Hit.")
            except Exception as e:
                logger.error("Marketaux Error: %s", e)

        if len(news_list) < 3 and alpha_vantage_key:
            time_from = search_start_str.replace("-", "") + "T0000"
            time_to = search_end_str.replace("-", "") + "T2359"
            url_av = f"https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers={symbol}&apikey={alpha_vantage_key}&time_from={time_from}&time_to={time_to}&limit=15"
            try:
                response = requests.get(url_av)
                data = response.json()
                if "feed" in data:
                    for item in data["feed"]:
                        news_list.append({
                            "title": item.get("title"),
                            "source": item.get("source"),
                            "url": item.get("url"),
                            "date": item.get("time_published"),
                            "relevance_score": 0.5
                        })
            except Exception as e:
                logger.error("Alpha Vantage Error: %s", e)

        if not news_list: continue
            
        news_list.sort(key=lambda x: (x.get('relevance_score', 0), x.get('date', '')), reverse=True)
        shock_tasks.append({
            "ticker": symbol,
            "date": shock_date_str,
            "change": shock['change'],
            "news": news_list,
            "end_date": shock['end_date']
        })

    # Parallel Execution of Shock Analysis
    if shock_tasks:
        import concurrent.futures
        logger.info("Processing %d shock events in parallel...", len(shock_tasks))
        
        def process_shock_task(task):
            try:
                result = analyze_price_shock(
                    task['ticker'], 
                    task['date'], 
                    task['change'], 
                    task['news'], 
                    end_date_str=task['end_date']
                )
                return {**result, "shock_date": task['date']}
            except Exception as e:
                logger.error("Error in parallel shock: %s", e)
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            futures = [executor.submit(process_shock_task, t) for t in shock_tasks]
            
            for future in concurrent.futures.as_completed(futures):
                analysis = future.result()
                if not analysis: continue

                if analysis.get('is_relevant') is False and analysis.get('headline') != 'Market Sentiment':
                    continue
                if not analysis.get('summary'):
                    continue

                sentiment = analysis.get('sentiment', 'neutral').lower()
                if 'positive' in sentiment:
                    color, position = "#22c55e", "belowBar"
                elif 'negative' in sentiment:
                    color, position = "#ef4444", "aboveBar"
                else:
                    color, position = "#fbbf24", "aboveBar"
                
                markers.append({
                    "time": analysis['shock_date'],
                    "text": "", 
                    "label": "N",
                    "color": color,
                    "shape": "circle",
                    "position": position,
                    "headline": analysis.get('summary', 'No summary available.')
                })
                existing_dates.append(analysis['shock_date'])
            
    return markers

@app.get("/")
def health_check():
    return {"status": "ok", "message": "Stock Analyzer API is running with SEC Engine"}

# Analysis cache — persisted to disk so Render cold-starts don't flush it.
# TTL is 6 h in production: cloud IPs get throttled by yfinance on every restart,
# so we cache aggressively to avoid hammering the upstream API.
ANALYSIS_CACHE_FILE = "analysis_cache.json"
ANALYSIS_CACHE_TTL = 21600   # 6 hours
ANALYSIS_CACHE_MAX = 100

def _load_analysis_cache() -> dict:
    if not os.path.exists(ANALYSIS_CACHE_FILE):
        return {}
    try:
        with open(ANALYSIS_CACHE_FILE, 'r') as f:
            return json.load(f)
    except Exception:
        return {}

def _save_analysis_cache() -> None:
    try:
        with open(ANALYSIS_CACHE_FILE, 'w') as f:
            json.dump(ANALYSIS_CACHE, f)
    except Exception as e:
        logger.error("Error saving analysis cache: %s", e)

ANALYSIS_CACHE: dict = _load_analysis_cache()

def _evict_cache_if_full(cache: dict, max_size: int) -> None:
    """Drop the oldest half of entries when the cache is at capacity."""
    if len(cache) >= max_size:
        to_delete = list(cache.keys())[:len(cache) // 2]
        for k in to_delete:
            del cache[k]

@app.get("/api/analyze/{ticker}")
def analyze_stock(ticker: str, refresh: bool = False):
    ticker_key = _validate_ticker(ticker)
    current_time = time.time()
    
    # Check Cache (skip when caller explicitly requests a refresh)
    if not refresh and ticker_key in ANALYSIS_CACHE:
        cached_entry = ANALYSIS_CACHE[ticker_key]
        if current_time - cached_entry['timestamp'] < ANALYSIS_CACHE_TTL:
            logger.info("Serving cached analysis for %s", ticker_key)
            return cached_entry['data']

    try:
        data = get_real_data(ticker)
        if not data:
            raise HTTPException(status_code=404, detail="Stock data not found.")

        # get_real_data already calls generate_narrative internally and merges the
        # result into `data`, so we extract rather than calling it a second time.

        # Build the minimal context needed for AI valuation normalization.
        vm = data.get('valuationMultiples') or {}
        financials_context = {
            'name': data.get('name', ticker_key),
            'sector': vm.get('sector', ''),
            'industry': vm.get('industry', ''),
            'lifecycle': data.get('lifecycle', 'Mature Stable'),
            'suggestedModel': data.get('suggestedModel', 'FCFF'),
            'rawRevenueGrowth': data.get('revenueGrowth', 0.05),
            'rawOperatingMargin': data.get('operatingMargin', 0.15),
            'marketCapB': round(data.get('marketCap', 0) / 1000, 1),
            'roic': data.get('roic', 0.15),
            'beta': data.get('beta', 1.0),
        }
        valuation_adjustments = get_valuation_adjustments(ticker_key, financials_context)

        result = {
            "financials": data,
            "aiReport": data.get('aiReport'),
            "narrative": data.get('narrative'),
            "valuationAdjustments": valuation_adjustments,
        }

        _evict_cache_if_full(ANALYSIS_CACHE, ANALYSIS_CACHE_MAX)
        ANALYSIS_CACHE[ticker_key] = {
            "timestamp": current_time,
            "data": result
        }
        _save_analysis_cache()

        logger.info("Caching fundamental analysis for %s", ticker_key)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

_VALID_PERIODS = {"1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"}

@app.get("/api/stock-history/{ticker}")
def get_history(ticker: str, period: str = Query("1y"), refresh: bool = False):
    ticker = _validate_ticker(ticker)
    if period not in _VALID_PERIODS:
        raise HTTPException(status_code=422, detail=f"Invalid period '{period}'. Choose from: {', '.join(sorted(_VALID_PERIODS))}.")
    try:
        data = get_stock_history(ticker, period)
        if not data or not data.get('history'):
            raise HTTPException(status_code=404, detail="History not found")
            
        ticker_key = f"{ticker.upper()}_{period}"
        cache = load_cache()
        news_markers = []
        
        if not refresh and ticker_key in cache:
            news_markers = cache[ticker_key]
        else:
            news_markers = get_stock_news(ticker, data['history'])
            cache[ticker_key] = news_markers
            save_cache(cache)
        
        return {
            "ticker": ticker.upper(),
            "period": period,
            "history": data['history'],
            "markers": news_markers
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/metrics/{ticker}")
def get_metrics(ticker: str):
    ticker = _validate_ticker(ticker)
    try:
        data = get_metric_details(ticker)
        if not data:
            raise HTTPException(status_code=404, detail="Metrics not found")
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# NEW: Graham Valuation Endpoint (Phase 1 Deep Financials)
@app.get("/api/valuation/{ticker}")
def get_valuation_financials(ticker: str):
    ticker = _validate_ticker(ticker)
    try:
        engine = SECEngine(ticker)
        data = engine.get_full_financials()
        if not data:
            raise HTTPException(status_code=404, detail="SEC data not available for this ticker.")
        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SEC Engine Error: {str(e)}")

@app.get("/api/search-ticker/{query}")
def search_ticker_endpoint(query: str, offset: int = Query(0, ge=0), limit: int = Query(10, ge=1, le=50)):
    try:
        query = _validate_search_query(query)
        paged = offset != 0 or limit != 10
        results = search_ticker(query, offset=offset, limit=limit, paged=paged)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
