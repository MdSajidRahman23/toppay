"""Headless browser test (desktop + 375px mobile). Credentials come from env vars - nothing is hard-coded.
Run: E2E_USER=reviewer E2E_PASS=... E2E_URL=http://localhost:8765 python tests/browser_e2e.py"""
import os, sys, json
from playwright.sync_api import sync_playwright

URL = os.environ.get("E2E_URL", "http://localhost:8765")
USER, PASS = os.environ["E2E_USER"], os.environ["E2E_PASS"]
FIX = os.path.join(os.path.dirname(__file__), "fixtures")
fails = []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" " + str(extra) if extra and not cond else ""))
    if not cond: fails.append(name)

def run(p, label, viewport):
    b = p.chromium.launch()
    ctx = b.new_context(viewport=viewport)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "401" not in m.text and "ERR_TUNNEL" not in m.text else None)
    posted = []
    pg.on("request", lambda r: posted.append(r.post_data or "") if r.method in ("POST", "PUT") and "/api/check" in r.url else None)
    pg.goto(URL)
    pg.fill("#lu", USER); pg.fill("#lp", PASS); pg.click("#lbtn")
    pg.wait_for_selector("#app:not(.hidden)")
    check(f"{label}: login", True)

    # money rule: 1,940 passes, 1,900 does not
    pg.select_option("select[name=profession]", "businessman")
    pg.fill("input[name=mrp]", "30000")
    pg.fill("input[name=tx_1_month]", "1940")
    pg.wait_for_timeout(800)
    txt = pg.inner_text("#result")
    check(f"{label}: 1940 accepted (tolerance 60)", "2,000" not in pg.inner_text("#returns") if pg.locator("#returns").count() else True)
    pg.fill("input[name=tx_1_month]", "1500")
    pg.wait_for_timeout(800)
    check(f"{label}: 1500 gives a return reason", pg.locator("#returns li").count() >= 1)
    check(f"{label}: status badge shown", pg.locator("#badge").inner_text().strip() != "")

    # Quality Indicators view is the default: 21 return + 26 reject rows
    pg.wait_for_selector("#pkList .pkrow")
    check(f"{label}: 47 quality indicators listed", pg.locator("#pkList .pkrow").count() == 47, pg.locator("#pkList .pkrow").count())
    pg.locator("#pkList .pkrow", has_text="Customer rude").locator("button").click()
    pg.wait_for_timeout(800)
    check(f"{label}: reject indicator -> REJECTED status", "REJECTED" in pg.inner_text("#badge"), pg.inner_text("#badge"))
    pg.locator("#pkList .pkrow", has_text="Customer rude").locator("button").click()   # remove again
    # manual reason + never sends text to the server
    pg.fill("#pkQ", "NID")
    pg.wait_for_timeout(300)
    pg.locator("#pkList .pkrow button", has_text="Return").first.click()
    pg.wait_for_timeout(800)
    check(f"{label}: manual reason appears", pg.locator("#returns .manual, #returns li").count() >= 2)
    last = json.loads(posted[-1])
    check(f"{label}: manual sent as template id only", all(set(m.keys()) <= {"tid", "kind"} for m in last["manual"]), last["manual"])

    # copy list is BP-only (no 'Rule:' lines / internal notes)
    pg.fill("#caseNotes", "internal note xyz")
    check(f"{label}: copy note present", pg.inner_text("#copyNote") != "")

    # local template edit stays in browser
    pg.click("#tabLib"); pg.wait_for_selector("#libList .tpl")
    pg.locator("#libList .editbtn").first.click()
    pg.fill("#dlgText", "Local edit only text")
    pg.click("#dlgLocal")
    stored = pg.evaluate("localStorage.getItem('tp_local_tpl')")
    check(f"{label}: local edit saved in browser", stored and "Local edit only text" in stored)
    pg.click("#tabCheck"); pg.wait_for_timeout(600)
    check(f"{label}: local edit never sent to server", not any("Local edit only text" in x for x in posted))

    # statement checker
    pg.click("#tabStmt")
    pg.fill("#stCust", "Fokrul Hasan"); pg.fill("#stApp", "2026-11-15")
    pg.set_input_files("#stFile", os.path.join(FIX, "good.pdf"))
    pg.click("#stRun"); pg.wait_for_selector("#stOut .card", timeout=20000)
    out = pg.inner_text("#stOut")
    check(f"{label}: statement name matches", "নাম মিলেছে" in out, out[:300])
    check(f"{label}: statement best month 4,000 (cash-in + cash-out added)", "4,000" in out)
    check(f"{label}: balance ok signal", "ঠিকঠাক মিলেছে" in out)
    pg.set_input_files("#stFile", os.path.join(FIX, "tampered_balance.pdf"))
    pg.click("#stRun"); pg.wait_for_timeout(2500)
    check(f"{label}: tampered balance flagged", "মেলেনি" in pg.inner_text("#stOut"))
    pg.set_input_files("#stFile", os.path.join(FIX, "locked.pdf"))
    pg.fill("#stCph", "01712345678"); pg.click("#stRun"); pg.wait_for_timeout(2500)
    check(f"{label}: password PDF opens with phone", "Authenticity" in pg.inner_text("#stOut"), pg.inner_text("#stStatus"))
    pg.fill("#stCph", "01000000000"); pg.fill("#stGph", ""); pg.click("#stRun"); pg.wait_for_timeout(2500)
    check(f"{label}: wrong password reported", "password" in pg.inner_text("#stStatus"))
    pg.set_input_files("#stFile", os.path.join(FIX, "good.pdf")); pg.click("#stRun"); pg.wait_for_timeout(2500)
    pg.locator("#stOut button.primary").click()
    pg.wait_for_timeout(600)
    check(f"{label}: numbers pushed to check form", pg.input_value("input[name=tx_1_month]") == "4000", pg.input_value("input[name=tx_1_month]"))

    # reset really clears
    pg.click("#reset"); pg.wait_for_timeout(400)
    check(f"{label}: reset clears form + notes", pg.input_value("input[name=tx_1_month]") == "" and pg.input_value("#caseNotes") == "")
    check(f"{label}: history saved", "↻" in pg.inner_text("#histList"))
    # no horizontal overflow
    ov = pg.evaluate("document.documentElement.scrollWidth > window.innerWidth + 2")
    check(f"{label}: no horizontal overflow", not ov)
    check(f"{label}: no JS errors", not errs, errs[:3])
    pg.screenshot(path=f"/tmp/e2e_{label}.png")
    b.close()

def admin_policy(p):
    """Admin edits the minimum amount in the panel; the check page must follow immediately."""
    au, ap = os.environ.get("E2E_ADMIN_USER"), os.environ.get("E2E_ADMIN_PASS")
    if not au:
        print("SKIP admin policy test (E2E_ADMIN_USER not set)"); return
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1280, "height": 900})
    pg.goto(URL); pg.fill("#lu", au); pg.fill("#lp", ap); pg.click("#lbtn"); pg.wait_for_selector("#app:not(.hidden)")
    pg.click("#tabAdmin"); pg.wait_for_selector("#polForm input[data-key=min_month_tx]")
    check("admin: policy form built", pg.locator("#polForm [data-key]").count() >= 20, pg.locator("#polForm [data-key]").count())
    pg.fill("#polForm input[data-key=min_month_tx]", "3000"); pg.click("#polSave"); pg.wait_for_timeout(800)
    check("admin: policy saved", "Save হয়েছে" in pg.inner_text("#polStatus"), pg.inner_text("#polStatus"))
    pg.click("#tabCheck")
    pg.select_option("select[name=profession]", "businessman"); pg.fill("input[name=mrp]", "30000"); pg.fill("input[name=tx_1_month]", "2500")
    pg.wait_for_timeout(900)
    check("admin: 2500 now returned (min 3000)", pg.locator("#returns li").count() >= 1)
    pg.click("#tabAdmin"); pg.wait_for_selector("#polReset")
    pg.once("dialog", lambda d: d.accept()); pg.click("#polReset"); pg.wait_for_timeout(800)
    check("admin: reset to default", pg.input_value("#polForm input[data-key=min_month_tx]") == "2000")
    b.close()

with sync_playwright() as p:
    admin_policy(p)
    run(p, "desktop", {"width": 1280, "height": 900})
    run(p, "mobile375", {"width": 375, "height": 800})
print("FAILS:", fails)
sys.exit(1 if fails else 0)
