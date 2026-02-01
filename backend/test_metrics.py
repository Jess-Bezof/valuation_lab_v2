import sys
import os
import yfinance as yf

# Ensure we can import from current directory
sys.path.append(os.getcwd())

try:
    from stock_data import get_metric_details
except ImportError:
    # Fallback if running from parent dir
    sys.path.append(os.path.join(os.getcwd(), 'backend'))
    from stock_data import get_metric_details

print(f"yfinance version: {yf.__version__}")

def test_ticker(ticker):
    print(f"\n--- Testing {ticker} ---")
    try:
        data = get_metric_details(ticker)
        if data:
            print("✅ Success!")
            print(data)
        else:
            print("❌ Failed (Returned None)")
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    test_ticker("AAPL")
    test_ticker("MSFT")
    # Test a ticker that might be problematic or just to verify failure
    test_ticker("INVALID_TICKER_XYZ")