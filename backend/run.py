"""Start the Hougang ABC backend: `python run.py` (http://127.0.0.1:5001).

Port 5001 because macOS reserves 5000 for AirPlay. Settings come from the repo's `.env`.
"""

import os

from dotenv import load_dotenv

from hougang.config import REPO_DIR

load_dotenv(REPO_DIR / ".env")

from hougang.bootstrap import AppBootstrap  # noqa: E402  (after load_dotenv so the config sees .env)

app = AppBootstrap().create_app()
os.environ.pop("ADMIN_PASSWORD", None)  # hashed by AppBootstrap; don't keep the plaintext around

if __name__ == "__main__":
    # debug=False: Flask's reloader would start the daily job twice.
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", "5001")), debug=False)
