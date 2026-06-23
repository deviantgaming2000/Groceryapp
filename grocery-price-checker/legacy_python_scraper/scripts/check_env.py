import importlib.util
import sys

REQUIRED = [
    "fastapi",
    "sqlalchemy",
    "pydantic",
    "typer",
    "rich",
    "playwright",
    "httpx",
    "bs4",
    "rapidfuzz",
    "jinja2",
    "dotenv",
]


def main():
    print(f"Python executable: {sys.executable}")
    print(f"Python version: {sys.version.split()[0]}")
    missing = [name for name in REQUIRED if importlib.util.find_spec(name) is None]
    if missing:
        print("Missing packages:")
        for name in missing:
            print(f"  - {name}")
        print("\nInstall with:")
        print("  python3 -m pip install -r requirements.txt")
        print("  python3 -m playwright install chromium")
        raise SystemExit(1)
    print("Environment looks ready.")


if __name__ == "__main__":
    main()
