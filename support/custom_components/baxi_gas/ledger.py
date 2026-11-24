"""Local, restart-safe Baxi gas readings and estimated consumption."""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone
import math
from typing import Any

SAMPLE_SECONDS = 15
MAX_SAMPLE_GAP = 30
BUCKET_SECONDS = 3600
HISTORY_SECONDS = 62 * 86400
MIN_CALIBRATION_COVERAGE = 0.95
MIN_CALIBRATION_ENERGY = 1.0
MIN_CALIBRATION_INTERVALS = 3

TELEMETRY = ("outdoor", "indoor", "setpoint", "modulation")


class GasLedger:
    """Integrate fresh power and keep manual readings independent of estimates."""

    def __init__(self, saved: dict[str, Any] | None = None) -> None:
        self.data = saved if saved is not None else {
            "readings": [],
            "buckets": {},
            "totals": {"kwh": 0.0, "valid_seconds": 0.0, "m3": 0.0, "rub": 0.0},
            "tariffs": [],
        }
        self.previous: tuple[float, dict[str, float | None]] | None = None

    @property
    def tariff(self) -> float | None:
        tariffs = self.data["tariffs"]
        return tariffs[-1]["rub_m3"] if tariffs else None

    def calibration(self) -> dict[str, Any]:
        intervals = [
            reading for reading in self.data["readings"][-15:]
            if reading.get("eligible")
        ]
        measured = sum(row["m3"] for row in intervals)
        energy = sum(row["kwh"] for row in intervals)
        return {
            "intervals": len(intervals),
            "coefficient": (
                measured / energy
                if len(intervals) >= MIN_CALIBRATION_INTERVALS and measured > 0
                else None
            ),
        }

    def sample(self, timestamp: float, values: dict[str, float | None]) -> None:
        previous = self.previous
        if previous is not None and timestamp <= previous[0]:
            return
        self.previous = timestamp, values
        if previous is None:
            return
        start, held = previous
        if timestamp - start > MAX_SAMPLE_GAP:
            return
        power = held["power"]
        if values["power"] is None:
            power = None
        coefficient = self.calibration()["coefficient"] if power is not None else None
        tariff = self.tariff
        while start < timestamp:
            hour = int(start // BUCKET_SECONDS) * BUCKET_SECONDS
            end = min(timestamp, hour + BUCKET_SECONDS)
            self._add_sample(hour, end - start, held, power, coefficient, tariff)
            start = end

    def _add_sample(
        self, hour: int, seconds: float, held: dict[str, float | None],
        power: float | None, coefficient: float | None, tariff: float | None,
    ) -> None:
        totals = self.data["totals"]
        buckets = self.data["buckets"]
        key = str(hour)
        if key not in buckets:
            buckets[key] = {
                "kwh": 0.0, "valid_seconds": 0.0, "m3": 0.0,
                "estimate_seconds": 0.0, "rub": 0.0, "priced_seconds": 0.0,
                "context": {},
            }
        bucket = buckets[key]
        for name in TELEMETRY:
            if (value := held.get(name)) is not None:
                context = bucket["context"].setdefault(name, [0.0, 0.0])
                context[0] += value * seconds
                context[1] += seconds
        if power is None:
            return
        energy = power * seconds / 3600
        bucket["kwh"] += energy
        totals["kwh"] += energy
        bucket["valid_seconds"] += seconds
        totals["valid_seconds"] += seconds
        if coefficient is not None:
            volume = energy * coefficient
            bucket["estimate_seconds"] += seconds
            bucket["m3"] += volume
            totals["m3"] += volume
            if tariff is not None:
                cost = volume * tariff
                bucket["priced_seconds"] += seconds
                bucket["rub"] += cost
                totals["rub"] += cost

    def prune(self, now: float) -> None:
        cutoff = now - HISTORY_SECONDS - BUCKET_SECONDS
        self.data["buckets"] = {
            key: row for key, row in self.data["buckets"].items() if int(key) >= cutoff
        }

    def set_tariff(self, timestamp: float, rub_m3: float) -> None:
        if not math.isfinite(rub_m3) or not 0 <= rub_m3 <= 10000:
            raise ValueError("invalid_tariff")
        if rub_m3 != self.tariff:
            self.data["tariffs"].append({"at": timestamp, "rub_m3": rub_m3})

    def add_reading(self, timestamp: float, value: float, other_gas: bool) -> None:
        if not math.isfinite(value) or not 0 <= value < 1e9:
            raise ValueError("invalid_reading")
        readings = self.data["readings"]
        totals = self.data["totals"]
        value = round(value, 3)
        previous = readings[-1] if readings else None
        if previous and (timestamp <= previous["at"] or value < previous["value"]):
            raise ValueError("reading_decreased")
        reading = {
            "at": timestamp, "value": value, "total_kwh": totals["kwh"],
            "total_valid_seconds": totals["valid_seconds"], "other_gas": other_gas,
        }
        if previous is not None:
            elapsed = timestamp - previous["at"]
            energy = totals["kwh"] - previous["total_kwh"]
            coverage = min(1.0, (totals["valid_seconds"] - previous["total_valid_seconds"]) / elapsed)
            gas = round(value - previous["value"], 3)
            eligible = (
                not other_gas and coverage >= MIN_CALIBRATION_COVERAGE
                and energy >= MIN_CALIBRATION_ENERGY and gas > 0
            )
            coefficient = self.calibration()["coefficient"]
            tariffs = self.data["tariffs"]
            tariff = next((row["rub_m3"] for row in reversed(tariffs) if row["at"] <= previous["at"]), None)
            tariff_changed = any(previous["at"] < row["at"] < timestamp for row in tariffs)
            reading.update(
                from_at=previous["at"], m3=gas, kwh=energy, coverage=coverage,
                eligible=eligible, expected_m3=energy * coefficient if eligible and coefficient is not None else None,
                rub=gas * tariff if tariff is not None and not tariff_changed else None,
            )
        readings.append(reading)

    def _period(self, start: float, end: float) -> dict[str, Any]:
        context = {name: [0.0, 0.0] for name in TELEMETRY}
        energy = volume = cost = valid = estimated = priced = 0.0
        for key, bucket in self.data["buckets"].items():
            hour = int(key)
            stop = min(hour + BUCKET_SECONDS, end)
            overlap = stop - max(start, hour)
            if overlap <= 0:
                continue
            fraction = overlap / (stop - hour)
            energy += bucket["kwh"] * fraction
            valid += bucket["valid_seconds"] * fraction
            volume += bucket["m3"] * fraction
            estimated += bucket["estimate_seconds"] * fraction
            cost += bucket["rub"] * fraction
            priced += bucket["priced_seconds"] * fraction
            for name, (total, seconds) in bucket["context"].items():
                context[name][0] += total * fraction
                context[name][1] += seconds * fraction
        known = [
            row for row in self.data["readings"]
            if row.get("from_at", -1) >= start and row["at"] <= end
        ]
        known_priced = sum(row["rub"] is not None for row in known)
        duration = max(end - start, 1.0)
        return {
            "kwh": energy if valid else None,
            "power_coverage": min(1.0, valid / duration),
            "m3": volume if estimated else None,
            "estimate_coverage": min(1.0, estimated / duration),
            "rub": cost if priced else None,
            "priced_coverage": min(1.0, priced / duration),
            "meter_m3": sum(row["m3"] for row in known) if known else None,
            "meter_rub": sum(row["rub"] for row in known) if known and known_priced == len(known) else None,
            "meter_coverage": min(1.0, sum(row["at"] - row["from_at"] for row in known) / duration),
            "context": {name: total / seconds if seconds else None for name, (total, seconds) in context.items()},
        }

    def snapshot(self, now: datetime) -> dict[str, Any]:
        local_day = now.date()
        boundaries = {
            "day": datetime.combine(local_day, time.min, now.tzinfo).timestamp(),
            "week": datetime.combine(local_day - timedelta(days=now.weekday()), time.min, now.tzinfo).timestamp(),
            "month": datetime.combine(local_day.replace(day=1), time.min, now.tzinfo).timestamp(),
            "rolling30": now.timestamp() - 30 * 86400,
        }
        return {
            "periods": {label: self._period(start, now.timestamp()) for label, start in boundaries.items()},
            "readings": list(reversed(self.data["readings"][-14:])),
            "tariff": self.tariff,
            "calibration": self.calibration(),
            "room_trend": self._room_trend(now.timestamp()),
            "timezone": getattr(now.tzinfo, "key", str(timezone.utc)),
        }

    def _room_trend(self, now: float) -> str | None:
        hour = int(now // BUCKET_SECONDS) * BUCKET_SECONDS
        buckets = self.data["buckets"]
        averages = []
        for offset in (2, 1):
            context = buckets.get(str(hour - offset * BUCKET_SECONDS), {}).get("context", {})
            total, seconds = context.get("indoor", [0.0, 0.0])
            if seconds < BUCKET_SECONDS / 2:
                return None
            averages.append(total / seconds)
        delta = averages[1] - averages[0]
        if delta >= 0.3:
            return "warming"
        if delta <= -0.3:
            return "cooling"
        return "stable"
