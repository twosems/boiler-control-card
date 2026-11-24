"""Regression checks for calibration, gaps, calendar boundaries and tariff changes."""

from datetime import datetime, timedelta
import importlib.util
import json
from pathlib import Path
import unittest
from zoneinfo import ZoneInfo

path = Path(__file__).resolve().parents[1] / "support/custom_components/baxi_gas/ledger.py"
spec = importlib.util.spec_from_file_location("gas_ledger", path)
ledger_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger_module)
GasLedger = ledger_module.GasLedger


class GasLedgerTest(unittest.TestCase):
    def setUp(self):
        self.ledger = GasLedger()
        self.zone = ZoneInfo("Asia/Tomsk")
        self.start = datetime(2026, 11, 23, 0, 0, tzinfo=self.zone).timestamp()
        self.cursor = self.start
        self.ledger.sample(self.cursor, {"power": 10, "indoor": 20})

    def advance(self, seconds, power=10, indoor=20):
        while seconds:
            step = min(seconds, 15)
            self.cursor += step
            self.ledger.sample(self.cursor, {"power": power, "indoor": indoor, "outdoor": -15, "setpoint": 53})
            seconds -= step

    def data(self):
        return self.ledger.snapshot(datetime.fromtimestamp(self.cursor, self.zone))

    def calibrate(self):
        self.ledger.add_reading(self.cursor, 1000, False)
        for index in range(1, 4):
            self.advance(3600)
            self.ledger.add_reading(self.cursor, 1000 + index, False)

    def test_calibration_does_not_backfill_and_uses_prior_estimate(self):
        self.calibrate()
        self.assertEqual(self.ledger.calibration()["intervals"], 3)
        self.assertAlmostEqual(self.ledger.calibration()["coefficient"], 0.1)
        self.assertIsNone(self.data()["periods"]["day"]["m3"])
        self.advance(3600)
        self.ledger.add_reading(self.cursor, 1004.2, False)
        result = self.data()
        self.assertAlmostEqual(result["readings"][0]["expected_m3"], 1.0)
        self.assertAlmostEqual(result["periods"]["day"]["m3"], 1.0)
        self.assertAlmostEqual(result["periods"]["day"]["meter_m3"], 4.2)

    def test_gap_and_stove_exclude_intervals(self):
        self.ledger.add_reading(self.cursor, 10, False)
        self.advance(3600)
        self.ledger.add_reading(self.cursor, 11, True)
        self.advance(1800)
        self.advance(1800, power=None)
        self.ledger.add_reading(self.cursor, 12, False)
        rows = self.data()["readings"]
        self.assertFalse(rows[1]["eligible"])
        self.assertFalse(rows[0]["eligible"])
        self.assertLess(rows[0]["coverage"], 0.51)
        self.assertAlmostEqual(self.data()["periods"]["week"]["meter_m3"], 2)

    def test_shutdown_gap_is_not_integrated_after_restart(self):
        self.advance(3600)
        saved = json.loads(json.dumps(self.ledger.data))
        self.ledger = GasLedger(saved)
        self.cursor += 3600
        self.advance(30)
        self.assertAlmostEqual(self.ledger.data["totals"]["valid_seconds"], 3615)
        self.assertLess(self.data()["periods"]["day"]["power_coverage"], 0.51)

    def test_tariff_changes_only_future_cost(self):
        self.calibrate()
        self.ledger.set_tariff(self.cursor, 6)
        self.advance(3600)
        self.ledger.set_tariff(self.cursor, 8)
        self.advance(3600)
        before = self.data()["periods"]["day"]
        self.assertAlmostEqual(before["rub"], 14.0)
        self.assertAlmostEqual(before["m3"], 2.0)
        self.ledger.set_tariff(self.cursor, 10)
        self.assertAlmostEqual(self.data()["periods"]["day"]["rub"], 14.0)

    def test_measured_cost_needs_known_constant_tariff_over_interval(self):
        self.ledger.set_tariff(self.cursor, 6)
        self.ledger.add_reading(self.cursor, 1200, False)
        self.advance(3600)
        self.ledger.add_reading(self.cursor, 1201, False)
        self.assertAlmostEqual(self.data()["periods"]["day"]["meter_rub"], 6.0)
        self.advance(3600)
        self.ledger.set_tariff(self.cursor, 7)
        self.advance(3600)
        self.ledger.add_reading(self.cursor, 1202, False)
        self.assertIsNone(self.data()["periods"]["day"]["meter_rub"])
        self.assertEqual(self.data()["periods"]["day"]["meter_m3"], 2.0)

    def test_monday_calendar_month_and_rolling_windows(self):
        self.calibrate()
        self.advance(3600)
        tuesday = datetime(2026, 11, 24, 4, tzinfo=self.zone)
        result = self.ledger.snapshot(tuesday)["periods"]
        self.assertIsNone(result["day"]["m3"])
        self.assertAlmostEqual(result["week"]["m3"], 1)
        self.assertAlmostEqual(result["month"]["m3"], 1)
        december = tuesday.replace(month=12, day=1)
        result = self.ledger.snapshot(december)["periods"]
        self.assertIsNone(result["month"]["m3"])
        self.assertIsNone(result["week"]["m3"])
        self.assertAlmostEqual(result["rolling30"]["m3"], 1)
        self.assertIsNone(self.ledger.snapshot(december + timedelta(days=30))["periods"]["rolling30"]["m3"])

    def test_room_trend_needs_two_hours(self):
        self.advance(3600, indoor=20)
        self.assertIsNone(self.data()["room_trend"])
        self.advance(3600, indoor=20.6)
        self.assertEqual(self.data()["room_trend"], "warming")

    def test_zero_off_does_not_make_unknown_into_zero(self):
        self.advance(3600, power=None)
        self.assertIsNone(self.data()["periods"]["day"]["kwh"])
        self.advance(3600, power=0)
        result = self.data()["periods"]["day"]
        self.assertAlmostEqual(result["kwh"], 0.0)
        self.assertLess(result["power_coverage"], 0.5)

    def test_reject_non_finite_and_decreasing_reading(self):
        self.ledger.add_reading(self.cursor, 10, False)
        self.advance(60)
        for value in (float("nan"), float("inf"), 9, -1):
            with self.assertRaises(ValueError):
                self.ledger.add_reading(self.cursor, value, False)
        self.assertEqual(len(self.ledger.data["readings"]), 1)


if __name__ == "__main__":
    unittest.main()
