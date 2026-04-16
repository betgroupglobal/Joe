
import sys, os
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/home/user/.playwright"
sys.path.insert(0, "/home/user/.local/lib/python3.10/site-packages")

from playwright.sync_api import sync_playwright
import time

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=False,  # Visible mode - harder to detect
        slow_mo=50,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-extensions",
        ]
    )
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        locale="en-AU",
        timezone_id="Australia/Sydney",
    )
    # Remove webdriver flag via JS
    ctx.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-AU', 'en'] });
        window.chrome = { runtime: {} };
    """)
    page = ctx.new_page()
    print("Navigating...")
    page.goto("https://www.joefortunepokies.win/join", wait_until="networkidle", timeout=30000)
    print(f"Title: {page.title()}")
    print(f"URL: {page.url}")
    
    time.sleep(2)
    
    # Dismiss cookie overlay
    for sel in ["button:has-text('Accept all')", "button:has-text('Accept')"]:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=1000):
                el.click()
                print(f"Dismissed: {sel}")
                time.sleep(1)
        except: pass
    
    page.wait_for_timeout(3000)
    print(f"After dismiss URL: {page.url}")
    
    inputs = page.query_selector_all("input:not([type='hidden']):not([type='submit'])")
    print(f"\nTotal inputs: {len(inputs)}")
    for inp in inputs:
        print(f"  type={inp.get_attribute('type')} name={inp.get_attribute('name')} id={inp.get_attribute('id')} placeholder={inp.get_attribute('placeholder')}")
    
    buttons = page.query_selector_all("button")
    print(f"\nButtons: {len(buttons)}")
    for btn in buttons[:8]:
        t = btn.inner_text()[:40].strip()
        if t: print(f"  [{t}] type={btn.get_attribute('type')}")
    
    page.screenshot(path="/home/user/output/autoform/debug_visible.png", full_page=True)
    print("\nScreenshot: debug_visible.png")
    browser.close()
