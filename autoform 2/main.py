"""
autoform/main.py - CLI entry point with proxy & stealth support.
"""
import argparse, logging, sys
from playwright.sync_api import sync_playwright
import config
from csv_loader import load_csv, validate_row
from crazytel import CrazyTelClient
from form_filler import run_signup

STEALTH_JS = ("Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
             " Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });"
             " Object.defineProperty(navigator, 'languages', { get: () => ['en-AU', 'en'] });"
             " window.chrome = { runtime: {} };")


def setup_logging():
    fmt = "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL, "INFO"),
        format=fmt,
        handlers=[logging.StreamHandler(sys.stdout),
                  logging.FileHandler(config.LOG_FILE, encoding="utf-8")],
    )


def parse_args():
    p = argparse.ArgumentParser(description="AutoForm — automated sign-up")
    p.add_argument("--url",         required=True)
    p.add_argument("--csv",         default=config.DEFAULT_CSV_PATH)
    p.add_argument("--headless",    action="store_true")
    p.add_argument("--no-crazytel", action="store_true")
    p.add_argument("--no-submit",   action="store_true")
    p.add_argument("--service",     default="any")
    p.add_argument("--row",         type=int, default=None)
    p.add_argument("--proxy",       default="", help="Proxy URL e.g. http://user:pass@host:port")
    return p.parse_args()


def main():
    setup_logging()
    log = logging.getLogger("main")
    args = parse_args()

    rows = load_csv(args.csv)
    if args.row is not None:
        rows = [rows[args.row]]
    log.info("Processing %d row(s) from %s", len(rows), args.csv)

    crazytel = None
    if not args.no_crazytel:
        crazytel = CrazyTelClient()

    headless = args.headless or (config.DEFAULT_BROWSER_MODE == "headless")
    slow_mo  = config.SLOW_MO if not headless else 0
    results  = []

    # Proxy config (CLI arg overrides env/config)
    proxy_url = args.proxy or config.PROXY_SERVER
    proxy_cfg = None
    if proxy_url:
        proxy_cfg = {"server": proxy_url}
        if config.PROXY_USERNAME:
            proxy_cfg["username"] = config.PROXY_USERNAME
            proxy_cfg["password"] = config.PROXY_PASSWORD
        log.info("Using proxy: %s", proxy_url)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=headless, slow_mo=slow_mo,
            args=["--disable-blink-features=AutomationControlled",
                  "--disable-infobars", "--no-first-run"],
        )
        ctx_args = dict(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            locale="en-AU",
            timezone_id="Australia/Sydney",
        )
        if proxy_cfg:
            ctx_args["proxy"] = proxy_cfg
        context = browser.new_context(**ctx_args)
        context.add_init_script(STEALTH_JS)
        context.set_default_timeout(config.ACTION_TIMEOUT)
        context.set_default_navigation_timeout(config.NAVIGATION_TIMEOUT)

        for i, row in enumerate(rows):
            if not validate_row(row):
                log.warning("Skipping invalid row %d", i)
                continue
            log.info("Row %d | %s", i, row.get("email"))
            page = context.new_page()
            try:
                res = run_signup(
                    page=page, url=args.url, row=row,
                    crazytel_client=crazytel, service=args.service,
                    submit=not args.no_submit,
                )
                results.append(res)
                log.info("Row %d: %s | phone: %s", i, res["status"], res.get("phone"))
            except Exception as exc:
                log.error("Row %d crashed: %s", i, exc, exc_info=True)
                results.append({"email": row.get("email"), "status": "error"})
            finally:
                page.close()
        browser.close()

    print(chr(10) + "="*60)
    print(f"  AUTOFORM SUMMARY — {len(results)} account(s)")
    print("="*60)
    ok = sum(1 for r in results if r["status"] == "completed")
    for r in results:
        icon = "V" if r["status"] == "completed" else "X"
        print(f"  [{icon}] {r.get('email','?'):<35} {r['status']}  phone={r.get('phone','N/A')}")
    print(f"  Succeeded: {ok}  Failed: {len(results)-ok}")
    print("="*60)


if __name__ == "__main__":
    main()