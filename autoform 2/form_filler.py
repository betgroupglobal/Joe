"""
autoform/form_filler.py
Intelligent field mapper + form filler with JS fallback and overlay dismissal.
"""
import logging
import time
from playwright.sync_api import Page
from scanner import FormField, scan_forms
from schema import FIELD_MAP, INPUT_TYPE_MAP
from config import ACTION_TIMEOUT

log = logging.getLogger(__name__)


def dismiss_overlays(page: Page) -> None:
    """Try to dismiss common overlays: cookie banners, age gates, modals."""
    dismiss_selectors = [
        "button:has-text('Accept')", "button:has-text('I Accept')",
        "button:has-text('Accept All')", "button:has-text('OK')",
        "button:has-text('Close')", "button:has-text('Got it')",
        "button:has-text('Continue')", "button:has-text('Agree')",
        "button:has-text('I am 18')", "button:has-text('Yes, I am')",
        "button:has-text('Enter')", "[aria-label='Close']", ".modal-close",
        ".cookie-accept", "#accept-cookies", ".close-modal", ".overlay-close"
    ]
    for sel in dismiss_selectors:
        try:
            el = page.locator(sel).first
            if el.is_visible(timeout=500):
                el.click(timeout=2000)
                log.info("Dismissed overlay: %s", sel)
                time.sleep(0.5)
        except Exception:
            pass


def js_fill(page: Page, selector: str, value: str) -> bool:
    """Fill a field using JavaScript — bypasses scroll/visibility restrictions."""
    try:
        result = page.evaluate(
            """([sel, val]) => {
                const el = document.querySelector(sel);
                if (!el) return false;
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                if (nativeInputValueSetter) {
                    nativeInputValueSetter.call(el, val);
                } else {
                    el.value = val;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }"""
            , [selector, value]
        )
        if result:
            log.info("JS-filled  %-35s = %s", selector, value[:40])
            return True
        log.warning("JS fill: element not found: %s", selector)
        return False
    except Exception as exc:
        log.warning("JS fill failed %s: %s", selector, exc)
        return False


def _score_field(form_field: FormField, keywords: list[str]) -> int:
    score = 0
    haystack = " ".join([
        form_field.name, form_field.id, form_field.placeholder,
        form_field.label_text, form_field.aria_label,
    ]).lower()
    for kw in keywords:
        if kw in haystack:
            score += 1
    return score


def match_fields(form_fields, row, phone_override=None):
    mapping = {}
    used = set()
    if phone_override:
        row = {**row, "phone": phone_override}
    for col, value in row.items():
        if not value or col not in FIELD_MAP:
            continue
        keywords = FIELD_MAP[col]
        best_score, best_field = 0, None
        for ff in form_fields:
            if ff.selector in used:
                continue
            if ff.input_type in INPUT_TYPE_MAP and INPUT_TYPE_MAP[ff.input_type] == col:
                best_score, best_field = 999, ff
                break
            s = _score_field(ff, keywords)
            if s > best_score:
                best_score, best_field = s, ff
        if best_field and best_score > 0:
            mapping[best_field.selector] = value
            used.add(best_field.selector)
    return mapping


def fill_form(page, mapping, form_fields):
    lookup = {ff.selector: ff for ff in form_fields}
    # Dismiss any overlays first
    dismiss_overlays(page)
    for selector, value in mapping.items():
        ff = lookup.get(selector)
        if not ff:
            continue
        filled = False
        # --- Attempt 1: Standard Playwright interaction ---
        try:
            el = page.locator(selector).first
            # Try scroll without timeout (non-blocking)
            try:
                el.scroll_into_view_if_needed(timeout=3000)
            except Exception:
                pass  # continue even if scroll fails
            if ff.tag == "select":
                try:
                    el.select_option(value=value, timeout=5000)
                except Exception:
                    el.select_option(label=value, timeout=5000)
                filled = True
            elif ff.input_type == "checkbox":
                if value.lower() in ("true", "yes", "1", "on"):
                    el.check(timeout=5000)
                filled = True
            elif ff.input_type == "radio":
                page.locator(f"input[type='radio'][value='{value}']").check(timeout=5000)
                filled = True
            elif ff.input_type == "date":
                try:
                    el.fill(value, timeout=5000)
                    filled = True
                except Exception:
                    filled = js_fill(page, selector, value)
            else:
                el.click(timeout=5000)
                el.fill("", timeout=3000)
                el.type(value, delay=30)
                filled = True
            if filled:
                log.info("Filled  %-35s = %s", selector, value[:40])
        except Exception as exc:
            log.debug("Playwright fill failed for %s: %s — trying JS fallback", selector, exc)
            # --- Attempt 2: JavaScript fallback ---
            if not filled:
                filled = js_fill(page, selector, value)
            if not filled:
                log.warning("Could not fill %s (both methods failed)", selector)
        time.sleep(0.15)


def fill_otp(page, otp, timeout=10000):
    patterns = [
        "input[name*='otp']", "input[name*='code']", "input[name*='verify']",
        "input[id*='otp']",   "input[id*='code']",   "input[id*='verify']",
        "input[placeholder*='code']", "input[placeholder*='OTP']",
        "input[autocomplete='one-time-code']",
        "input[name='code-0']",  # multi-box OTP (first box)
    ]
    for pat in patterns:
        try:
            el = page.locator(pat).first
            if el.count():
                # Try splitting OTP across multiple boxes
                boxes = page.locator("input[name^='code-']").all()
                if len(boxes) > 1:
                    for i, digit in enumerate(otp[:len(boxes)]):
                        try:
                            boxes[i].fill(digit)
                        except Exception:
                            js_fill(page, f"input[name='code-{i}']", digit)
                    log.info("OTP filled across %d boxes", len(boxes))
                    return True
                el.fill(otp, timeout=timeout)
                log.info("OTP filled via %s", pat)
                return True
        except Exception:
            continue
    log.warning("OTP input not found automatically")
    return False




def fill_pin(page, pin: str) -> bool:
    """Detect and fill a 4-digit security PIN field.
    Handles both single <input> and split 4-box PIN inputs."""
    # Single PIN input patterns
    single_patterns = [
        "input[name*='pin']",   "input[id*='pin']",
        "input[name*='PIN']",   "input[id*='PIN']",
        "input[placeholder*='PIN']", "input[placeholder*='pin']",
        "input[autocomplete='off']",
    ]
    # Split 4-box PIN (like OTP boxes but for PIN)
    split_patterns = [
        "input[name*='pin-']", "input[id*='pin-']",
        "input[name*='pin_']", "input[id*='digit']",
    ]
    # Try split PIN boxes first
    for pat in split_patterns:
        try:
            boxes = page.locator(pat).all()
            if len(boxes) >= 4:
                for i, digit in enumerate(pin[:len(boxes)]):
                    try:
                        boxes[i].fill(digit)
                    except Exception:
                        js_fill(page, f"{pat}:nth-child({i+1})", digit)
                log.info("PIN filled across %d split boxes", len(boxes))
                return True
        except Exception:
            pass
    # Try single PIN input
    for pat in single_patterns:
        try:
            el = page.locator(pat).first
            if el.count():
                try:
                    el.fill(pin)
                except Exception:
                    js_fill(page, pat, pin)
                log.info("PIN filled via %s", pat)
                return True
        except Exception:
            continue
    return False
def run_signup(page, url, row, crazytel_client=None, service="any", submit=True):
    result = {"url": url, "email": row.get("email"), "status": "pending", "phone": None}
    page.goto(url, wait_until="domcontentloaded")
    page.wait_for_timeout(2000)
    # Dismiss overlays on load
    dismiss_overlays(page)
    page.wait_for_timeout(1000)
    # Dismiss overlays FIRST, then scan
    dismiss_overlays(page)
    page.wait_for_timeout(1500)  # wait for page to settle post-dismiss
    form_fields = scan_forms(page)
    if not form_fields:
        result["status"] = "no_form_detected"
        return result
    number_id, phone_number = None, None
    if crazytel_client:
        try:
            number_id, phone_number = crazytel_client.get_number_and_wait_otp(service)
            result["phone"] = phone_number
        except Exception as exc:
            log.warning("CrazyTel error: %s", exc)
    mapping = match_fields(form_fields, row, phone_override=phone_number)
    fill_form(page, mapping, form_fields)
    # Handle PIN separately if present
    if row.get("pin"):
        fill_pin(page, str(row["pin"]))
    if submit:
        try:
            submit_sel = (
                "button[type='submit'], input[type='submit'], "
                "button:has-text('Sign up'), button:has-text('Register'), "
                "button:has-text('Create account'), button:has-text('Get started'), "
                "button:has-text('Join'), button:has-text('Join Now'), "
                "button:has-text('Next'), button:has-text('Continue')"
            )
            page.locator(submit_sel).first.click(timeout=ACTION_TIMEOUT)
            page.wait_for_timeout(3000)
            log.info("Form submitted for %s", row.get("email"))
        except Exception as exc:
            log.warning("Submit failed: %s", exc)
            result["status"] = "submit_failed"
            return result
    if crazytel_client and number_id:
        sms = crazytel_client.poll_sms(number_id)
        if sms:
            otp = crazytel_client.extract_otp(sms)
            if otp:
                fill_otp(page, otp)
                try:
                    page.locator("button[type='submit']").first.click(timeout=ACTION_TIMEOUT)
                    page.wait_for_timeout(2000)
                except Exception:
                    pass
        crazytel_client.release_number(number_id)
    result["status"] = "completed"
    return result