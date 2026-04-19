"""Launcher entrypoint for the TRELLIS webapp.

This module exists so the web UI can be started as `webapp.app2:app`
without changing the main application code.
"""

from webapp.app import app


__all__ = ["app"]


if __name__ == "__main__":
    import os

    import uvicorn

    uvicorn.run(
        "webapp.app2:app",
        host="0.0.0.0",
        port=int(os.environ.get("WEBAPP_PORT", "8010")),
        reload=False,
    )