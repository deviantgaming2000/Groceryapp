import argparse
import asyncio
from pathlib import Path

try:
    from playwright.async_api import async_playwright
except ModuleNotFoundError as exc:
    if exc.name != "playwright":
        raise
    raise SystemExit(
        "Playwright is not installed for this Python interpreter.\n\n"
        "From the grocery-price-checker directory, run:\n"
        "  python3 -m pip install -r requirements.txt\n"
        "  python3 -m playwright install chromium\n\n"
        "Then retry:\n"
        "  python3 scripts/login_store.py --store walmart --profile-dir ./profiles/walmart"
    ) from exc

LOGIN_URLS = {
    "walmart": "https://www.walmart.com/account/login",
    "safeway": "https://www.safeway.com/account/sign-in.html",
    "kroger": "https://www.frysfood.com/signin",
}


async def main():
    parser = argparse.ArgumentParser(description="Open a persistent browser profile so you can sign into a store manually.")
    parser.add_argument("--store", choices=LOGIN_URLS, required=True)
    parser.add_argument("--profile-dir", required=True)
    args = parser.parse_args()

    profile_dir = Path(args.profile_dir).expanduser()
    profile_dir.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        context = await playwright.chromium.launch_persistent_context(
            str(profile_dir),
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto(LOGIN_URLS[args.store], wait_until="domcontentloaded")
        print(f"Opened {args.store} login page.")
        print("Sign in normally, complete any 2FA/CAPTCHA manually, select your local store if needed, then press Enter here.")
        input()
        await context.close()
    print(f"Saved browser profile at: {profile_dir}")
    print("Add this path in the web app Store sign-in / location section, or in store_sessions.json.")


if __name__ == "__main__":
    asyncio.run(main())
