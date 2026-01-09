import concurrent.futures
import yfinance as yf
import pandas as pd
import numpy as np
import requests
from ai_service import get_competitors_from_ai, get_major_events_from_ai, generate_fundamental_analysis
import sys
import traceback
from fastapi import HTTPException
from functools import lru_cache
from datetime import datetime
import time

SECTOR_LEADERS = {
    'Technology': ['MSFT', 'AAPL', 'NVDA', 'ORCL', 'ADBE', 'CRM', 'AMD', 'INTC'],
    'Financial Services': ['JPM', 'BAC', 'V', 'MA', 'MS', 'GS', 'WFC', 'C'],
    'Healthcare': ['JNJ', 'LLY', 'PFE', 'MRK', 'ABT', 'TMO', 'UNH', 'BMY'],
    'Consumer Cyclical': ['AMZN', 'TSLA', 'HD', 'MCD', 'NKE', 'SBUX', 'LOW', 'F'],
    'Consumer Defensive': ['PG', 'KO', 'PEP', 'COST', 'WMT', 'CL', 'MO', 'TGT'],
    'Energy': ['XOM', 'CVX', 'SHEL', 'TTE', 'COP', 'BP', 'EOG', 'SLB'],
    'Communication Services': ['GOOGL', 'META', 'NFLX', 'DIS', 'TMUS', 'CMCSA', 'VZ', 'T'],
    'Industrials': ['HON', 'UPS', 'UNP', 'CAT', 'GE', 'DE', 'LMT', 'BA'],
    'Utilities': ['NEE', 'DUK', 'SO', 'D', 'AEP'],
    'Real Estate': ['PLD', 'AMT', 'CCI', 'EQIX', 'PSA', 'O'],
    'Basic Materials': ['LIN', 'SHW', 'FCX', 'NEM', 'DOW']
}

PS_CACHE = {}
PS_CACHE_TTL = 3600  # seconds

def get_ps_ratio_from_info(info, revenue_ttm):
    ps = info.get('priceToSalesTrailing12Months') or info.get('trailingPS') or None
    if ps and ps > 0:
        return float(ps)
    market_cap = info.get('marketCap', 0)
    if market_cap and revenue_ttm and revenue_ttm > 0:
        return float(safe_divide(market_cap, revenue_ttm))
    return 0.0

def safe_divide(numerator, denominator):
    if denominator is None or denominator == 0:
        return 0.0
    return numerator / denominator


def get_historical_ratios(ticker: str):
    """
    Fetches 5 years of historical data to calculate annual valuation metrics.
    """
    print(f"DEBUG: Fetching historical ratios for {ticker}")
    try:
        stock = yf.Ticker(ticker)
        # Fetch history (price) and financials (EPS, Revenue)
        history = stock.history(period="5y")
        financials = stock.financials
        balance_sheet = stock.balance_sheet
        
        # We need "Basic EPS" or "Diluted EPS", "Total Revenue", "Stockholders Equity"
        # Financials columns are dates.
        if financials.empty or history.empty:
            return []

        historical_metrics = []
        
        # Sort columns descending (newest first), but we want to iterate over them
        dates = financials.columns
        
        for date in dates:
            # Convert timestamp to date string
            date_str = date.strftime('%Y-%m-%d')
            year = date.strftime('%Y')
            
            # Find close price on or near this date
            # We use 'asof' logic or simple nearest search
            try:
                # Use the closest trading day's close price
                # Ensure date is timezone-naive or matches history index timezone
                # Often financials dates are year-end. 
                # history index is DatetimeIndex.
                
                # Check if date exists in history
                if date in history.index:
                    price = history.loc[date]['Close']
                else:
                    # Find nearest index
                    idx = history.index.get_indexer([date], method='nearest')[0]
                    if idx == -1: continue
                    price = history.iloc[idx]['Close']
            except:
                continue
                
            # Get Financial Metrics
            try:
                # Basic EPS
                eps = get_financial_value(financials, ['Basic EPS', 'Diluted EPS'], date)
                
                # Revenue Per Share (Total Revenue / Shares)
                # We need Shares count at that time. 
                # "Basic Average Shares" or "Diluted Average Shares"
                shares = get_financial_value(financials, ['Basic Average Shares', 'Diluted Average Shares'], date)
                revenue = get_financial_value(financials, ['Total Revenue'], date)
                
                # Book Value Per Share (Equity / Shares)
                equity = get_financial_value(balance_sheet, ['Stockholders Equity', 'Total Equity Gross Minority Interest'], date)
                
                # Ratios
                pe = safe_divide(price, eps)
                ps = safe_divide(price * shares, revenue)
                pb = safe_divide(price * shares, equity)
                
                historical_metrics.append({
                    "year": year,
                    "pe": float(pe),
                    "ps": float(ps),
                    "pb": float(pb)
                })
            except Exception as e:
                # Skip year if calculation fails
                continue
                
        # Return sorted by year descending
        return sorted(historical_metrics, key=lambda x: x['year'], reverse=True)

    except Exception as e:
        print(f"Error fetching historical ratios for {ticker}: {e}")
        traceback.print_exc()
        return []

def get_financial_value(df, keys, col_date=None):
    """
    Helper to get value from DataFrame safely.
    If col_date is provided, fetches from that specific column.
    """
    for key in keys:
        if key in df.index:
            if col_date is not None:
                if col_date in df.columns:
                    val = df.loc[key, col_date]
                    return float(val) if val is not None else 0.0
            else:
                val = df.loc[key].iloc[0]
                return float(val) if val is not None else 0.0
    return 0.0

def get_real_data(ticker: str):
    print(f"\n--- 🔍 DEBUG: Starting fetch for {ticker} ---")
    
    # 1. CORE DATA (Priority 1)
    # We must have basic info and financials to proceed.
    try:
        stock = yf.Ticker(ticker)
        print("✅ yfinance Ticker object created.")
        
        info = stock.info
        if not info:
            raise ValueError("No info found")
        print(f"✅ Basic Info fetched. Sector: {info.get('sector', 'Unknown')}")
    except Exception as e:
        print(f"❌ Basic Info fetch failed: {e}")
        print(f"Critical Error fetching info for {ticker}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch stock info: {str(e)}")

    # Fetch Financials (Also Core)
    try:
        income_stmt = stock.financials
        balance_sheet = stock.balance_sheet
        cash_flow = stock.cashflow
        # Fill NaNs with 0 to avoid JSON serialization errors
        income_stmt = income_stmt.fillna(0)
        balance_sheet = balance_sheet.fillna(0)
        cash_flow = cash_flow.fillna(0)
    except Exception as e:
        print(f"Error fetching financials for {ticker}: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to fetch financials: {str(e)}")

    # 1. Risk Free Rate (^TNX)
    try:
        tnx = yf.Ticker("^TNX")
        # taking the last close price which is the yield
        tnx_hist = tnx.history(period="5d")
        if not tnx_hist.empty:
            risk_free_rate = tnx_hist['Close'].iloc[-1] / 100.0
        else:
            risk_free_rate = 0.042
    except:
        risk_free_rate = 0.042

    # 2. Financials for ROIC and Tax Rate
    # Revenue
    revenue = get_financial_value(income_stmt, ['Total Revenue', 'Revenue'])
    
    # Operating Income (EBIT)
    operating_income = get_financial_value(income_stmt, ['Operating Income', 'Ebit'])
    
    # Effective Tax Rate
    tax_provision = get_financial_value(income_stmt, ['Tax Provision', 'Income Tax Expense'])
    pretax_income = get_financial_value(income_stmt, ['Pretax Income'])
    
    effective_tax_rate = safe_divide(tax_provision, pretax_income)
    if effective_tax_rate == 0:
        effective_tax_rate = 0.21
        
    # Clamp tax rate to reasonable bounds
    if effective_tax_rate < 0 or effective_tax_rate > 0.5:
        effective_tax_rate = 0.21

    # Balance Sheet Items
    total_debt = get_financial_value(balance_sheet, ['Total Debt', 'Long Term Debt And Capital Lease Obligation'])
    cash = get_financial_value(balance_sheet, ['Cash And Cash Equivalents', 'Cash Financial'])
    total_equity = get_financial_value(balance_sheet, ['Stockholders Equity', 'Total Equity Gross Minority Interest'])

    # New Items for DDM
    dividends_paid = abs(get_financial_value(cash_flow, ['Cash Dividends Paid', 'Dividends Paid']))
    net_income = get_financial_value(income_stmt, ['Net Income', 'Net Income Common Stockholders'])

    # ROIC = EBIT / (Total Equity + Total Debt - Cash)
    invested_capital = total_equity + total_debt - cash
    roic = safe_divide(operating_income, invested_capital)

    # --- Reinvestment Efficiency (Sales-to-Capital) ---
    # Sales / Invested Capital
    reinvestment_efficiency = safe_divide(revenue, invested_capital)
    # ---------------------------------------------------

    # --- STEP 2: DYNAMIC COST OF DEBT & SYNTHETIC RATING ---
    # Calculate Interest Coverage Ratio
    interest_expense = abs(get_financial_value(income_stmt, ['Interest Expense'], None))
    coverage_ratio = safe_divide(operating_income, interest_expense) if interest_expense > 0 else 100

    # Determine Default Spread based on Coverage (Damodaran-style)
    if coverage_ratio > 8.5: 
        spread = 0.0067
        rating = "AAA"
    elif coverage_ratio > 6.5: 
        spread = 0.0082
        rating = "AA"
    elif coverage_ratio > 5.5: 
        spread = 0.0103
        rating = "A"
    elif coverage_ratio > 4.25: 
        spread = 0.0114
        rating = "A-"
    elif coverage_ratio > 3.0:
        spread = 0.0150
        rating = "BBB"
    else: 
        spread = 0.0350
        rating = "High Risk/B"

    dynamic_cost_of_debt = risk_free_rate + spread
    # -----------------------------------------------------------------

    # 3. Lifecycle Check
    # Need previous year revenue
    try:
        revenue_prev = income_stmt.loc['Total Revenue'].iloc[1] if 'Total Revenue' in income_stmt.index and len(income_stmt.columns) > 1 else revenue
        if revenue_prev > 0:
            revenue_growth = (revenue - revenue_prev) / revenue_prev
        else:
            revenue_growth = 0.0
    except:
        revenue_growth = 0.05
        
    lifecycle = 'High Growth' if revenue_growth > 0.15 else 'Mature Stable'

    # Calculate margins
    operating_margin = safe_divide(operating_income, revenue)

    # 4. Suggested Model Logic
    sector = info.get('sector', 'Unknown')
    industry = info.get('industry', 'Unknown')
    
    if sector in ['Financial Services', 'Real Estate']:
        suggested_model = 'DDM'
    elif revenue_growth > 0.20:
        suggested_model = 'HIGH_GROWTH'
    else:
        suggested_model = 'FCFF'

    # Market Data
    market_cap = info.get('marketCap', 0)
    if not market_cap: # Estimate if missing
        market_cap = info.get('previousClose', 0) * info.get('sharesOutstanding', 0)

    beta = info.get('beta', 1.0)
    if beta is None: beta = 1.0

    # Valuation Multiples
    trailing_pe = info.get('trailingPE')
    valuation_multiples = {
        "pe": trailing_pe if trailing_pe is not None else 0,
        "forwardPe": info.get('forwardPE'),
        "evToEbitda": info.get('enterpriseToEbitda'),
        "priceToBook": info.get('priceToBook'),
        "ps": 0,
        "earningsYield": (1 / trailing_pe * 100) if trailing_pe and trailing_pe > 0 else None,
        "sector": sector,
        "industry": industry
    }
    try:
        cache_key = f"{ticker.upper()}"
        now = time.time()
        cached = PS_CACHE.get(cache_key)
        if cached and (now - cached['ts'] < PS_CACHE_TTL):
            valuation_multiples["ps"] = cached['value']
        else:
            ps_val = get_ps_ratio_from_info(info, revenue)
            valuation_multiples["ps"] = ps_val
            PS_CACHE[cache_key] = {"ts": now, "value": ps_val}
    except Exception as e:
        valuation_multiples["ps"] = 0

    # 5. Sector Specific Metrics
    sector_stats = get_sector_stats(sector, income_stmt, balance_sheet, cash_flow, info)

    # 6. ISOLATE COMPETITORS (Priority 2)
    peer_details = []
    try:
        # A. Check specific peers first (Legacy/Specific overrides)
        # 1. Direct Overrides
        direct_peers_map = {
             "NVDA": ["AMD", "INTC", "TSM"],
             "AMD": ["NVDA", "INTC", "QCOM"],
             "INTC": ["AMD", "NVDA", "TXN"]
        }
        
        target_peers = []
        if ticker.upper() in direct_peers_map:
            target_peers = direct_peers_map[ticker.upper()]
        else:
            # 2. AI Based Lookup
            company_name = info.get('longName', ticker.upper())
            print("⏳ Asking AI for competitors...")
            
            ai_peers = []
            try:
                from ai_service import get_competitors_from_ai
                ai_peers = get_competitors_from_ai(ticker.upper(), company_name)
            except Exception as e:
                print(f"❌ AI Service Error: {e}")
                traceback.print_exc()
                ai_peers = []

            print(f"✅ AI returned: {ai_peers}")
            
            if ai_peers:
                target_peers = ai_peers
            else:
                # 3. Sector Based Lookup (Fallback)
                sector_peers = SECTOR_LEADERS.get(sector, ['SPY', 'QQQ'])
                target_peers = [p for p in sector_peers if p != ticker.upper()]
                target_peers = target_peers[:5]
            
        # 4. Fetch Data for these peers (PARALLELIZED)
        print("⏳ Fetching peer details concurrently...")
        
        def fetch_peer(p_ticker):
            try:
                return get_metric_details(p_ticker)
            except Exception as e:
                print(f"⚠️ Warning: Could not fetch data for peer {p_ticker}: {e}")
                return None

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_ticker = {executor.submit(fetch_peer, p): p for p in target_peers}
            for future in concurrent.futures.as_completed(future_to_ticker):
                data = future.result()
                if data:
                    peer_details.append(data)

        print(f"✅ Peer details fetched: {len(peer_details)} peers found.")

    except Exception as e:
        print(f"Warning: Peer fetch failed for {ticker}: {e}")
        peer_details = []

    if not peer_details:
        print("⚠️ Peer list empty. Adding main ticker as fallback.")
        try:
            main_peer_data = get_metric_details(ticker)
            if main_peer_data:
                peer_details.append(main_peer_data)
        except Exception as e:
            print(f"Failed to add fallback peer data: {e}")

    # 7. ISOLATE HISTORY (Priority 3)
    historical_metrics = []
    try:
        historical_metrics = get_historical_ratios(ticker.upper())
    except Exception as e:
        print(f"Warning: History fetch failed for {ticker}: {e}")
        historical_metrics = []

    # 8. Construct Result
    print(f"Extraction Status: {ticker} success")
    result = {
        "ticker": ticker.upper(),
        "lastUpdated": datetime.now().isoformat(),
        "name": info.get('longName', ticker.upper()),
        "price": info.get('currentPrice', info.get('previousClose', 0.0)),
        "beta": beta,
        "marketCap": market_cap / 1_000_000,
        "totalDebt": total_debt / 1_000_000,
        "cash": cash / 1_000_000,
        "revenue": revenue / 1_000_000,
        "operatingIncome": operating_income / 1_000_000,
        "taxRate": effective_tax_rate,
        "sharesOutstanding": info.get('sharesOutstanding', 0) / 1_000_000,
        "salesPerShare": safe_divide(revenue, info.get('sharesOutstanding', 0)),
        "wacc": 0.08, # Placeholder - updated in frontend valuation
        "roic": roic,
        "reinvestmentEfficiency": reinvestment_efficiency, # NEW
        "listingStatus": 'Public',
        "costOfDebt": dynamic_cost_of_debt, # UPDATED: Step 2
        "syntheticRating": rating, # UPDATED: Step 2
        "riskFreeRate": risk_free_rate,
        "equityRiskPremium": 0.045,
        "lifecycle": lifecycle,
        "suggestedModel": suggested_model,
        "revenueGrowth": revenue_growth,
        "operatingMargin": operating_margin,
        "dividendsPaid": dividends_paid / 1_000_000,
        "netIncome": net_income / 1_000_000,
        "valuationMultiples": valuation_multiples,
        "peerDetails": peer_details,
        "historicalMetrics": historical_metrics,
        "sectorStats": sector_stats
    }

    # 9. Add Narrative
    try:
        result.update(generate_narrative(result))
    except Exception as e:
        print(f"Error generating narrative: {e}")

    return result

def get_sector_stats(sector, income, balance, cash_flow, info):
    """
    Returns a dictionary of sector-specific metrics.
    """
    stats = {
        "template": "Standard",
        "metrics": []
    }
    
    try:
        # Common Data
        revenue = get_financial_value(income, ['Total Revenue', 'Revenue'])
        net_income = get_financial_value(income, ['Net Income Common Stockholders', 'Net Income'])
        total_assets = get_financial_value(balance, ['Total Assets'])
        total_equity = get_financial_value(balance, ['Stockholders Equity', 'Total Equity Gross Minority Interest'])
        
        # Technology / SaaS
        if sector == 'Technology':
            stats["template"] = "Technology"
            
            # 1. Rule of 40 (Growth % + FCF Margin %)
            # Rev Growth
            rev_prev = income.loc['Total Revenue'].iloc[1] if 'Total Revenue' in income.index and len(income.columns) > 1 else revenue
            rev_growth = safe_divide((revenue - rev_prev), rev_prev) * 100
            
            # FCF Margin
            ocf = get_financial_value(cash_flow, ['Operating Cash Flow', 'Total Cash From Operating Activities'])
            capex = abs(get_financial_value(cash_flow, ['Capital Expenditure', 'Capital Expenditures']))
            fcf = ocf - capex
            fcf_margin = safe_divide(fcf, revenue) * 100
            
            rule_40 = rev_growth + fcf_margin
            
            # 2. R&D Intensity
            rnd = get_financial_value(income, ['Research And Development'])
            rnd_intensity = safe_divide(rnd, revenue) * 100
            
            # 3. Gross Margin
            gross_profit = get_financial_value(income, ['Gross Profit'])
            gross_margin = safe_divide(gross_profit, revenue) * 100
            
            stats["metrics"] = [
                {"label": "Rule of 40", "value": rule_40, "format": "number"},
                {"label": "R&D Intensity", "value": rnd_intensity, "format": "percent"},
                {"label": "Gross Margin", "value": gross_margin, "format": "percent"}
            ]

        # Retail / Consumer
        elif sector in ['Consumer Cyclical', 'Consumer Defensive', 'Retail']:
            stats["template"] = "Retail"
            
            # 1. Inventory Turnover
            cogs = get_financial_value(income, ['Cost Of Revenue', 'Cost Of Goods Sold'])
            inventory = get_financial_value(balance, ['Inventory'])
            inv_turnover = safe_divide(cogs, inventory)
            
            # 2. Net Margin
            net_margin = safe_divide(net_income, revenue) * 100
            
            # 3. ROA
            roa = safe_divide(net_income, total_assets) * 100
            
            stats["metrics"] = [
                {"label": "Inventory Turnover", "value": inv_turnover, "format": "number"},
                {"label": "Net Margin", "value": net_margin, "format": "percent"},
                {"label": "Return on Assets", "value": roa, "format": "percent"}
            ]

        # Financial Services
        elif sector == 'Financial Services':
            stats["template"] = "Banking"
            
            # 1. ROE
            roe = safe_divide(net_income, total_equity) * 100
            
            # 2. Equity Multiplier (Assets / Equity) - Leverage
            leverage = safe_divide(total_assets, total_equity)
            
            # 3. Book Value per Share (Already have, let's do Dividend Yield or Efficiency)
            # Efficiency Ratio (Non-Interest Exp / Revenue) - Hard to get clean data.
            # Let's use Dividend Yield from info
            div_yield = info.get('dividendYield', 0) * 100 if info.get('dividendYield') else 0
            
            stats["metrics"] = [
                {"label": "Return on Equity", "value": roe, "format": "percent"},
                {"label": "Fin. Leverage", "value": leverage, "format": "number"},
                {"label": "Dividend Yield", "value": div_yield, "format": "percent"}
            ]

        # Real Estate
        elif sector == 'Real Estate':
            stats["template"] = "REITs"
            
            # 1. FFO (Proxy: Net Income + Depreciation)
            depreciation = get_financial_value(cash_flow, ['Depreciation And Amortization', 'Depreciation'])
            ffo = net_income + depreciation
            
            # 2. Debt to EBITDA
            total_debt = get_financial_value(balance, ['Total Debt'])
            ebitda = get_financial_value(income, ['EBITDA', 'Normalized EBITDA'])
            if ebitda == 0: # Proxy
                 ebitda = get_financial_value(income, ['Operating Income', 'Ebit']) + depreciation
            
            debt_to_ebitda = safe_divide(total_debt, ebitda)
            
            # 3. Dividend Yield
            div_yield = info.get('dividendYield', 0) * 100 if info.get('dividendYield') else 0
            
            stats["metrics"] = [
                {"label": "Est. FFO (M)", "value": ffo / 1000000, "format": "currency"},
                {"label": "Debt / EBITDA", "value": debt_to_ebitda, "format": "number"},
                {"label": "Dividend Yield", "value": div_yield, "format": "percent"}
            ]

        else:
            # Standard Template
            stats["template"] = "General"
            
            # 1. Current Ratio
            curr_assets = get_financial_value(balance, ['Total Current Assets'])
            curr_liab = get_financial_value(balance, ['Total Current Liabilities'])
            curr_ratio = safe_divide(curr_assets, curr_liab)
            
            # 2. Debt to Equity
            total_debt = get_financial_value(balance, ['Total Debt'])
            debt_equity = safe_divide(total_debt, total_equity)
            
            # 3. Net Margin
            net_margin = safe_divide(net_income, revenue) * 100
            
            stats["metrics"] = [
                {"label": "Current Ratio", "value": curr_ratio, "format": "number"},
                {"label": "Debt / Equity", "value": debt_equity, "format": "number"},
                {"label": "Net Margin", "value": net_margin, "format": "percent"}
            ]
            
    except Exception as e:
        print(f"Error calculating sector stats: {e}")
        # Return empty metrics on error
        stats["metrics"] = []
        
    return stats

import time

EVENT_CACHE = {}

def get_major_events(ticker: str):
    """
    Fetches news and uses AI to summarize major events.
    Uses caching to minimize API calls (24 hour cache).
    """
    try:
        # Check Cache
        current_time = time.time()
        if ticker in EVENT_CACHE:
            cached_data = EVENT_CACHE[ticker]
            if current_time - cached_data['timestamp'] < 86400: # 24 hours
                print(f"✅ Using cached events for {ticker}")
                return cached_data['events']

        print(f"⏳ Fetching fresh events for {ticker}...")
        stock = yf.Ticker(ticker)
        news = stock.news
        
        if not news:
            return []
            
        # Transform news for AI
        news_for_ai = []
        for item in news:
            news_for_ai.append({
                "title": item.get('title'),
                "publisher": item.get('publisher'),
                "link": item.get('link'),
                "timestamp": item.get('providerPublishTime')
            })
            
        events = get_major_events_from_ai(ticker, news_for_ai)
        
        # Process Sentiment Colors
        # Green: #22c55e, Red: #ef4444, Yellow: #fbbf24
        for ev in events:
            sentiment = ev.get('sentiment', 'neutral').lower()
            if 'positive' in sentiment:
                ev['color'] = '#22c55e'
                ev['position'] = 'belowBar' # Good news below? Actually usually markers are above. Let's keep consistent.
                ev['shape'] = 'arrowUp'
            elif 'negative' in sentiment:
                ev['color'] = '#ef4444'
                ev['position'] = 'aboveBar'
                ev['shape'] = 'arrowDown'
            else:
                ev['color'] = '#fbbf24'
                ev['shape'] = 'circle'
        
        # Update Cache
        EVENT_CACHE[ticker] = {
            'timestamp': current_time,
            'events': events
        }
        
        return events
    except Exception as e:
        print(f"!!! AI QUOTA REACHED OR ERROR: {str(e)}")
        # Return empty list on failure instead of crashing
        return []

def get_stock_history(ticker: str, period="1y"):
    """
    Optimized for Step 3: Elastic Timeline.
    Fetches stock price history and events with high-performance iteration.
    """
    ticker = ticker.upper()
    history_data = []
    
    try:
        print(f"⏳ DEBUG: Fetching {period} history for {ticker}...")
        stock = yf.Ticker(ticker)
        
        # Optimization: Enforce 1d interval to keep payload predictable.
        # Enforce 'auto_adjust=True' to ensure Close prices are adjusted for splits.
        history = stock.history(period=period, interval="1d", auto_adjust=True)
        
        # FIX: Check if history is None or empty properly
        if history is None or history.empty:
            print(f"⚠️ No history data returned for {ticker}")
            return {"history": [], "events": []}
            
        if not history.empty:
            # Step 3 Optimization: Use .items() on the 'Close' Series for 5x faster iteration than iterrows()
            # Ensure the dates are strictly formatted as YYYY-MM-DD for lightweight-charts
            history_data = [
                {
                    "time": d.strftime('%Y-%m-%d'), 
                    "value": float(v)
                } 
                for d, v in history['Close'].items()
            ]
            
            # Ensure data is sorted by time (required for lightweight-charts)
            history_data.sort(key=lambda x: x['time'])
            
        print(f"✅ Extraction Status: {ticker} success ({len(history_data)} points)")
        
    except Exception as e:
        print(f"❌ Error fetching history for {ticker}: {e}")
        return {"history": [], "events": []}

    # 2. Fetch Events (AI Bonus)
    events_data = []
    try:
        # We only fetch events if the period is 1y or less to save AI tokens 
        # unless explicitly requested.
        events_data = get_major_events(ticker)
    except Exception as e:
        print(f"⚠️ AI Events Failed for {ticker}: {e}")
        events_data = []

    return {
        "history": history_data,
        "events": events_data,
        "ticker": ticker,
        "period": period
    }

# Deprecated but keeping for reference if needed, logic moved to get_real_data
def fetch_peer_details(ticker: str):
    return []

def get_metric_details(ticker: str):
    """
    Fetches valuation metrics for a single ticker.
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        
        trailing_pe = info.get('trailingPE', 0)
        revenue_ttm = info.get('totalRevenue') or info.get('revenueTrailing12Months') or 0
        ps_ratio = get_ps_ratio_from_info(info, revenue_ttm)
        
        print(f"Extraction Status: {ticker} success")
        return {
            "ticker": ticker.upper(),
            "metrics": {
                "pe": trailing_pe,
                "forwardPe": info.get('forwardPE', 0),
                "evToEbitda": info.get('enterpriseToEbitda', 0),
                "priceToBook": info.get('priceToBook', 0),
                "ps": ps_ratio,
                "earningsYield": (1 / trailing_pe * 100) if trailing_pe and trailing_pe > 0 else 0,
                "sector": info.get('sector', 'Unknown'),
                "industry": info.get('industry', 'Unknown')
            }
        }
    except Exception as e:
        print(f"Error fetching metrics for {ticker}: {e}")
        return None

def generate_narrative(data):
    """
    Generates a text-based analysis report based on the financial data.
    """
    ticker = data.get('ticker', 'Unknown')
    growth = data.get('revenueGrowth', 0)
    margin = data.get('operatingMargin', 0)
    roic = data.get('roic', 0)
    multiples = data.get('valuationMultiples', {})
    pe = multiples.get('pe', 0) if multiples else 0
    
    # 1. Growth Story
    if growth > 0.20:
        growth_verdict = "aggressive expansion"
        growth_desc = "high double-digit revenue growth"
    elif growth > 0.05:
        growth_verdict = "steady compounding"
        growth_desc = "moderate but stable top-line increases"
    else:
        growth_verdict = "consolidation"
        growth_desc = "flat or declining revenues"

    # 2. Profitability
    if margin > 0.20:
        prof_verdict = "highly profitable"
        prof_desc = "robust operating margins typical of a moat"
    elif margin > 0.05:
        prof_verdict = "healthy"
        prof_desc = "standard industry margins"
    else:
        prof_verdict = "capital intensive"
        prof_desc = "thin margins requiring strict cost control"

    # 3. Valuation
    if pe and pe > 30:
        val_desc = "commands a premium valuation"
    elif pe and pe > 15:
        val_desc = "trades at a fair market multiple"
    elif pe and pe > 0:
        val_desc = "appears undervalued relative to the broader market"
    else:
        val_desc = "has earnings metrics that make traditional P/E analysis difficult"

    # Construct Narrative
    # We use AI for the full report now, passing the structured data
    
    # Extract data correctly from input 'data' dictionary
    # The 'data' passed to this function is the result dictionary from get_real_data
    # So we need to look up values from 'data', not from local variables of get_real_data
    
    current_sector = data.get('valuationMultiples', {}).get('sector', 'Unknown')
    
    financial_context = {
        "ticker": ticker,
        "sector": current_sector,
        "price": data.get('price', 0),
        "pe": pe,
        "growth": growth,
        "margin": margin,
        "roic": roic,
        "leverage": "High" if data.get('syntheticRating') in ['High Risk/B', 'B', 'CCC'] else "Moderate"
    }

    ai_narrative = generate_fundamental_analysis(ticker, financial_context)
    
    # Fallback if AI fails
    if not ai_narrative:
         story = (
            f"{ticker} is currently in a phase of {growth_verdict}, characterized by {growth_desc}. "
            f"The business is {prof_verdict} with {prof_desc}. "
            f"From a market perspective, the stock {val_desc}."
        )
         drivers = (
            f"• Revenue Trajectory: {growth:.1%} growth rate signaling {growth_verdict}.\n"
            f"• Operational Efficiency: {margin:.1%} margins indicating {prof_verdict} operations.\n"
            f"• Capital Returns: ROIC of {roic:.1%}."
        )
         risks = (
            "• Macroeconomic sensitivity and interest rate changes.\n"
            "• Competitive margin pressure in the sector.\n"
            "• Execution risk in maintaining growth targets."
        )
         ai_narrative = {
             "companyDescription": f"{ticker} operates in the {current_sector} sector.",
             "valuationStory": story,
             "keyDrivers": drivers,
             "riskFactors": risks
         }

    return {
        "aiReport": ai_narrative.get('valuationStory'),
        "narrative": ai_narrative
    }

def search_ticker(query: str, offset: int = 0, limit: int = 10, paged: bool = False):
    """
    Searches for tickers matching the query string using Yahoo Finance Autocomplete API.
    """
    try:
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={query}"
        headers = {'User-Agent': 'Mozilla/5.0'}
        response = requests.get(url, headers=headers, timeout=5)
        data = response.json()
        
        quotes = data.get('quotes', [])
        total = len(quotes)
        results = []
        
        for quote in quotes:
            # Filter for equity only or relevant types
            if quote.get('quoteType') in ['EQUITY', 'ETF']:
                results.append({
                    "ticker": quote.get('symbol'),
                    "name": quote.get('shortname') or quote.get('longname'),
                    "exchange": quote.get('exchange')
                })
                
        if not paged:
            return results[:10]
        start = max(0, offset)
        end = start + max(1, limit)
        paged_results = results[start:end]
        return {
            "results": paged_results,
            "total": total,
            "offset": start,
            "limit": limit
        }
    except Exception as e:
        print(f"Error searching ticker {query}: {e}")
        return [] if not paged else {"results": [], "total": 0, "offset": offset, "limit": limit}
