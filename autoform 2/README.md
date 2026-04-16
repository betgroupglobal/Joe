# AutoForm

Automated website sign-up system powered by **Playwright** + **CrazyTel** virtual numbers.
Works on **any** sign-up page — the scanner auto-detects form fields.

## Quick Setup

```bash
pip install -r requirements.txt
playwright install chromium
export CRAZYTEL_API_KEY="your_key_here"
python main.py --url https://example.com/signup --csv sample_data.csv
```

## CLI Options

| Flag | Description |
|------|-------------|
| `--url URL` | Target sign-up page (required) |
| `--csv PATH` | Path to CSV (default: sample_data.csv) |
| `--headless` | Run browser invisibly |
| `--no-crazytel` | Skip CrazyTel, use CSV phone |
| `--no-submit` | Fill but do not submit (dry-run) |
| `--service NAME` | CrazyTel service filter |
| `--row N` | Process only row N (0-indexed) |

## CSV Schema

`first_name, last_name, email, password, dob, phone, address, city, state, zip_code, country, username, gender`

## Files

| File | Purpose |
|------|---------|
| config.py | Credentials & settings |
| schema.py | Field-matching keyword map |
| csv_loader.py | CSV loading & validation |
| crazytel.py | CrazyTel API client |
| scanner.py | Playwright form scanner |
| form_filler.py | Field mapper & filler engine |
| main.py | CLI entry point |
| sample_data.csv | Example user data |
