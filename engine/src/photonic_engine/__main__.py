"""Command-line entry point.

    python -m photonic_engine serve          # NDJSON RPC over stdio (default)
    python -m photonic_engine info --pretty  # environment diagnostics
    python -m photonic_engine scan ~/Pictures --pretty
"""

from __future__ import annotations

import argparse
import json
import sys

from .binaries import engine_info
from .protocol import EngineError
from .rpc import serve
from .scanner import scan_folder


def _print(payload: dict, pretty: bool) -> None:
    if pretty:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(json.dumps(payload, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="photonic-engine")
    parser.add_argument("--version", action="version", version="photonic-engine 0.1.0")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("serve", help="Speak NDJSON RPC over stdio (default)")

    info = sub.add_parser("info", help="Print engine and dependency diagnostics")
    info.add_argument("--pretty", action="store_true")

    scan = sub.add_parser("scan", help="Scan a folder and print media found")
    scan.add_argument("path")
    scan.add_argument("--hidden", action="store_true", help="Include dotfiles")
    scan.add_argument("--max-files", type=int, default=50_000)
    scan.add_argument("--pretty", action="store_true")

    args = parser.parse_args(argv)

    if args.command in (None, "serve"):
        serve()
        return 0

    if args.command == "info":
        _print(engine_info(), args.pretty)
        return 0

    if args.command == "scan":
        try:
            result = scan_folder(
                args.path,
                include_hidden=args.hidden,
                max_files=args.max_files,
            )
        except EngineError as exc:
            print(
                json.dumps({"ok": False, "error": exc.to_dict()}, ensure_ascii=False),
                file=sys.stderr,
            )
            return 2
        _print(result.to_dict(), args.pretty)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
