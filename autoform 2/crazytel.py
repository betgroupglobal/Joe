"""
autoform/crazytel.py
CrazyTel API integration: get number, poll SMS OTP, release number.
"""
import re
import time
import logging
import requests
from config import (
    CRAZYTEL_API_KEY, CRAZYTEL_BASE_URL, CRAZYTEL_COUNTRY,
    SMS_POLL_TIMEOUT, SMS_POLL_INTERVAL,
)

log = logging.getLogger(__name__)


class CrazyTelClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {CRAZYTEL_API_KEY}",
            "Content-Type":  "application/json",
            "Accept":        "application/json",
        })
        self.base = CRAZYTEL_BASE_URL.rstrip("/")

    def get_number(self, service: str = "any") -> dict:
        payload = {"country": CRAZYTEL_COUNTRY, "service": service}
        resp = self.session.post(f"{self.base}/numbers/request", json=payload)
        resp.raise_for_status()
        data = resp.json()
        log.info("Got CrazyTel number: %s (id=%s)", data["phone_number"], data["number_id"])
        return data

    def release_number(self, number_id: str) -> None:
        try:
            resp = self.session.delete(f"{self.base}/numbers/{number_id}")
            resp.raise_for_status()
            log.info("Released number %s", number_id)
        except Exception as exc:
            log.warning("Could not release number %s: %s", number_id, exc)

    def poll_sms(self, number_id: str) -> str | None:
        deadline = time.time() + SMS_POLL_TIMEOUT
        log.info("Polling SMS for number_id=%s (timeout=%ds)", number_id, SMS_POLL_TIMEOUT)
        while time.time() < deadline:
            resp = self.session.get(f"{self.base}/numbers/{number_id}/sms")
            resp.raise_for_status()
            messages = resp.json().get("messages", [])
            if messages:
                latest = messages[-1]["text"]
                log.info("Received SMS: %s", latest)
                return latest
            time.sleep(SMS_POLL_INTERVAL)
        log.error("SMS poll timed out for number_id=%s", number_id)
        return None

    def extract_otp(self, sms_text: str, digits: int = 6) -> str | None:
        import re
        match = re.search(rf"(\d{{{digits}}})", sms_text)
        if match:
            return match.group(1)
        match = re.search(r"(\d{4,8})", sms_text)
        return match.group(1) if match else None

    def get_number_and_wait_otp(self, service: str = "any") -> tuple[str, str]:
        data = self.get_number(service)
        return data["number_id"], data["phone_number"]