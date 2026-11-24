"""Shared configuration for the Baxi gas ledger."""

DOMAIN = "baxi_gas"
SIGNAL_UPDATED = f"{DOMAIN}_updated"
SOURCES = ("power", "flame", "outdoor", "indoor", "setpoint", "modulation")
