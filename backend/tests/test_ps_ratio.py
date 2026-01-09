import unittest
import sys
import types
# Stub ai_service to satisfy stock_data import
stub = types.ModuleType('ai_service')
stub.get_competitors_from_ai = lambda *args, **kwargs: []
stub.get_major_events_from_ai = lambda *args, **kwargs: []
stub.generate_fundamental_analysis = lambda *args, **kwargs: {}
sys.modules['ai_service'] = stub

from backend.stock_data import safe_divide, get_ps_ratio_from_info

class TestPSRatio(unittest.TestCase):
    def test_safe_divide_zero(self):
        self.assertEqual(safe_divide(10, 0), 0.0)
        self.assertEqual(safe_divide(0, 10), 0.0)
        self.assertEqual(safe_divide(10, None), 0.0)

    def test_api_ps_ratio(self):
        info = {"priceToSalesTrailing12Months": 2.5}
        ps = get_ps_ratio_from_info(info, revenue_ttm=1000000)
        self.assertAlmostEqual(ps, 2.5, places=6)

    def test_manual_ps_ratio(self):
        info = {"marketCap": 5_000_000_000}
        ps = get_ps_ratio_from_info(info, revenue_ttm=2_000_000_000)
        self.assertAlmostEqual(ps, 2.5, places=6)

    def test_missing_data_returns_zero(self):
        info = {}
        ps = get_ps_ratio_from_info(info, revenue_ttm=0)
        self.assertEqual(ps, 0.0)

if __name__ == '__main__':
    unittest.main()
