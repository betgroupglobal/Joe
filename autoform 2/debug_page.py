
import sys, os
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/home/user/.playwright"
sys.path.insert(0, "/home/user/.local/lib/python3.10/site-packages")

from playwright.sync_api import sync_playwright
import time

with sync_playwright() as pw:
    browser = pw.chromium.launch(
        headless=True,
        args=["--disable-blink-features=AutomationControlled"]
    )
    ctx = browser.new_context(
        viewport={"width": 1280, "height": 900},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36"
    )
    page = ctx.new_page()
    page.goto("https://www.joefortunepokies.win/join", wait_until="networkidle", timeout=30000)
    print(f"Title: {page.title()}")
    print(f"URL: {page.url}")
    
    # Dismiss any overlays
    for sel in ["button:has-text('Accept')", "button:has-text('OK')", "button:has-text('Close')"]:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=1000):
                el.click()
                print(f"Dismissed: {sel}")
                time.sleep(1)
        except: pass
    
    page.wait_for_timeout(3000)
    
    # Get all inputs
    inputs = page.query_selector_all("input:not([type='hidden']):not([type='submit'])")
    print(f"\nTotal inputs after dismiss: {len(inputs)}")
    for inp in inputs:
        print(f"  type={inp.get_attribute('type')} name={inp.get_attribute('name')} id={inp.get_attribute('id')} placeholder={inp.get_attribute('placeholder')}")
    
    # Check for buttons
    buttons = page.query_selector_all("button")
    print(f"\nTotal buttons: {len(buttons)}")
    for btn in buttons[:10]:
        print(f"  text='{btn.inner_text()[:50]}' type={btn.get_attribute('type')}")
    
    # Save screenshot
    page.screenshot(path="/home/user/output/autoform/debug_page.png")
    print("\nScreenshot saved to debug_page.png")
    
    browser.close()
