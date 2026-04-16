"""
autoform/scanner.py
Playwright-based form scanner. Detects all form fields on any webpage.
"""
import logging
from dataclasses import dataclass, field
from playwright.sync_api import Page

log = logging.getLogger(__name__)


@dataclass
class FormField:
    selector:     str
    tag:          str
    input_type:   str
    name:         str
    id:           str
    placeholder:  str
    label_text:   str
    aria_label:   str
    is_required:  bool
    options:      list[str] = field(default_factory=list)


def scan_forms(page: Page) -> list[FormField]:
    fields: list[FormField] = []
    elements = page.query_selector_all(
        "input:not([type='hidden']):not([type='submit']):not([type='button'])"
        ", select"
        ", textarea"
    )
    for el in elements:
        tag         = el.evaluate("e => e.tagName.toLowerCase()")
        input_type  = el.get_attribute("type") or ("select" if tag == "select" else "textarea")
        name        = el.get_attribute("name")        or ""
        el_id       = el.get_attribute("id")          or ""
        placeholder = el.get_attribute("placeholder") or ""
        aria_label  = el.get_attribute("aria-label")  or ""
        is_required = el.get_attribute("required") is not None
        label_text  = ""
        if el_id:
            lbl = page.query_selector(f"label[for='{el_id}']")
            if lbl:
                label_text = lbl.inner_text().strip()
        if not label_text:
            label_text = el.evaluate(
                "e => { let p = e.closest('label'); if (p) return p.innerText.trim();"
                " let prev = e.previousElementSibling;"
                " while (prev) { if (prev.tagName === 'LABEL') return prev.innerText.trim();"
                " prev = prev.previousElementSibling; } return ''; }"
            )
        if el_id:
            selector = f"#{el_id}"
        elif name:
            selector = f"{tag}[name='{name}']"
        else:
            selector = tag
        options = []
        if tag == "select":
            options = el.evaluate("e => Array.from(e.options).map(o => o.value).filter(v => v)")
        fields.append(FormField(
            selector=selector, tag=tag, input_type=input_type.lower(),
            name=name, id=el_id, placeholder=placeholder,
            label_text=label_text, aria_label=aria_label,
            is_required=is_required, options=options,
        ))
    log.info("Scanned %d form field(s) on page", len(fields))
    return fields