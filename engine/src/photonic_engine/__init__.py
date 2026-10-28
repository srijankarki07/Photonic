"""Photonic engine - local execution core.

The engine is deliberately UI-agnostic. It speaks a small newline-delimited
JSON-RPC protocol over stdio (``python -m photonic_engine``) and can also be
driven directly from tests or a future CLI. It never opens a network port.
"""

__version__ = "0.1.0"
PROTOCOL_VERSION = 1
