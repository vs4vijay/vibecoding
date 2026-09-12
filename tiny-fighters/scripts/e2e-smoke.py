#!/usr/bin/env python3
# scripts/e2e-smoke.py — black-box browser gate for the Tiny Fighters web shell.
# Drives P1 keyboard-only through title → mode → select → stage-select →
# battle, asserts the sim is rendering (non-black canvas), opens pause, and
# returns to title. Usage: python3 scripts/e2e-smoke.py [--url http://localhost:2000/]
import argparse
from playwright.sync_api import sync_playwright

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:2000/")
    args = ap.parse_args()
    errors: list[str] = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page()
        page.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.goto(args.url, wait_until="networkidle")
        page.wait_for_timeout(600)

        def scene() -> str:
            return page.evaluate("document.querySelector('#ui .scene')?.className ?? 'none'")

        def key(k: str) -> None:
            page.keyboard.press(k)
            page.wait_for_timeout(300)

        assert scene().startswith("scene title"), f"boot: {scene()}"
        key("Comma")   # title: attack -> mode
        assert scene().startswith("scene mode"), f"mode: {scene()}"
        key("Comma")   # mode: confirm FFA -> select
        assert scene().startswith("scene select"), f"select: {scene()}"
        key("Comma")   # select: P1 joins
        joined = page.evaluate("[...document.querySelectorAll('.chip')].some(c => c.style.display !== 'none')")
        assert joined, "P1 chip never appeared"
        key("Period")  # select: jump-confirm -> stage-select (requires ctx.gotoArg fix)
        assert scene().startswith("scene stage-select"), f"stage-select: {scene()}"
        key("Comma")   # stage-select: confirm -> battle
        assert scene().startswith("scene battle"), f"battle: {scene()}"

        page.wait_for_timeout(2500)  # let the sim run
        non_black = page.evaluate("""(() => {
          const c = document.getElementById('game');
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] + d[i+1] + d[i+2] > 30) n++;
          return n;
        })()""")
        assert non_black > 1000, f"battle canvas is blank (non-black px = {non_black})"

        if scene().startswith("scene battle"):  # a bot FFA may have ended already
            key("Escape")
            assert page.evaluate("!!document.querySelector('#ui .overlay')"), "pause overlay did not open"
            page.get_by_text("QUIT TO MENU", exact=True).click()
            page.wait_for_timeout(400)
            assert scene().startswith("scene title"), f"quit-to-title: {scene()}"

        assert not errors, "browser errors:\n" + "\n".join(errors)
        b.close()
    print("E2E SMOKE: PASS")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
