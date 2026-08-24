#!/usr/bin/env python3
"""Task 5 browser verification: locomotion displacement, jump, crouch, slope, fps.

Runs the vite dev server headless via playwright (python), drives __lugaru +
real key events, captures screenshots + numeric traces. Prints JSON verdicts.
"""
import json
import math
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = "/Volumes/Main/GitHub/lugaru-web-sdd/lugaru-web"
SHOTS = "/Volumes/Main/GitHub/lugaru-web-sdd/.superpowers/sdd/2026-08-23-lugaru-web-combat-prototype/shots"
URL = "http://localhost:5199/"

results = {}
errors = []


def wait_server(timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(URL, timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def evaljs(page, expr):
    return page.evaluate(expr)


def main():
    server = subprocess.Popen(
        ["bun", "run", "dev", "--", "--port", "5199", "--strictPort"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        if not wait_server():
            print(json.dumps({"FATAL": "dev server did not start"}))
            return 1
        with sync_playwright() as pw:
            # Headed: headless Chromium rejects pointer lock (WrongDocumentError).
            browser = pw.chromium.launch(headless=False, args=[
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ])
            page = browser.new_page(viewport={"width": 960, "height": 600})
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(URL)
            page.wait_for_function("() => window.__lugaru && window.__lugaru.player")
            # Pointer lock via a real user-gesture click.
            page.bring_to_front()
            page.mouse.click(480, 300)
            page.wait_for_function("() => document.pointerLockElement !== null")
            page.wait_for_timeout(400)

            def pos():
                return evaljs(page, "(() => { const p = window.__lugaru.player.pos; return [p.x, p.y, p.z]; })()")

            def stance():
                return evaljs(page, "window.__lugaru.player.stance")

            def reset_yaw():
                evaljs(page, "window.__lugaru.chaseCam.yaw = 0; window.__lugaru.chaseCam.pitch = 0.2")
            def press(page_, key, ms):
                page_.keyboard.down(key)
                page_.wait_for_timeout(ms)
                page_.keyboard.up(key)
            reset_yaw()
            x0, y0, z0 = pos()
            page.keyboard.down("w")
            page.wait_for_timeout(1000)
            page.screenshot(path=f"{SHOTS}/task5-run.png")  # mid-stride
            page.wait_for_timeout(1000)
            page.keyboard.up("w")
            x1, y1, z1 = pos()
            disp = math.hypot(x1 - x0, z1 - z0)
            results["run"] = {
                "displacement_m": round(disp, 2),
                "expected_m": round(6.2 * 2.0 * 0.92, 2),  # accel ramp ≈ 92% of ideal
                "ok": 10.0 < disp < 13.0,
                "stance": stance(),
            }

            # settle back to idle
            page.wait_for_timeout(800)

            reset_yaw()
            zs0 = pos()
            trace = []
            page.keyboard.press("Space")
            for _ in range(40):  # ~660ms of samples
                p = pos()
                trace.append(p[1])
                page.wait_for_timeout(16)
            peak = max(trace)
            ground = min(min(zs0[1], trace[-1]), 1e9)
            results["jump"] = {
                "peak_y": round(peak, 3),
                "ground_y": round(trace[-1], 3),
                "apex_gain_m": round(peak - zs0[1], 3),
                "left_ground": peak > zs0[1] + 0.4,
                "landed_back": abs(trace[-1] - zs0[1]) < 0.15,
            }

            # --- (c) crouch pose + stance --------------------------------------
            st_before = stance()
            page.keyboard.down("ShiftLeft")
            page.wait_for_timeout(700)
            st_crouch = stance()
            held = evaljs(page, "window.__lugaru.player.crouchHeldMs")
            pelvis_x = evaljs(page,
                "(window.__lugaru.rig.bones.pelvis.rotation.x)")
            spine_y = evaljs(page,
                "window.__lugaru.rig.bones.spine.position.y")
            root_y = pos()[1]
            # Crouch lowers pelvis world height vs standing (root y + spine offset).
            page.screenshot(path=f"{SHOTS}/task5-crouch.png")
            page.keyboard.up("ShiftLeft")
            page.wait_for_timeout(300)
            st_after = stance()
            results["crouch"] = {
                "stance_before": st_before, "stance_crouched": st_crouch,
                "stance_after_release": st_after,
                "crouchHeldMs": round(held),
                "pelvis_pitch_rad": round(pelvis_x, 3),
                "ok": st_before == "standing" and st_crouch == "crouched" and st_after == "standing",
            }
            _ = spine_y, root_y

            # --- (d) uphill slope alignment ------------------------------------
            # Teleport into the valley and walk +x (climbing toward the ridge).
            page.evaluate("""
              (() => {
                const p = window.__lugaru.player.pos;
                p.x = -15; p.z = 0; p.y = 2;
              })()
            """)
            reset_yaw()
            page.wait_for_timeout(120)
            page.keyboard.down("d")  # strafe right relative to yaw≈0 → +x world
            page.wait_for_timeout(1600)
            page.keyboard.up("d")
            pitch = evaljs(page, "window.__lugaru.rig.root.rotation.x")
            heading = evaljs(page, "window.__lugaru.player.heading")
            px, py, pz = pos()
            # Terrain grade along facing at final spot, from the sim's own fn.
            grade = evaljs(page, """
              (() => {
                const hAt = (x,z) => 1.2*Math.sin(x*0.08)*Math.cos(z*0.06)
                  + 0.6*Math.sin((x+z)*0.045) + 0.25*Math.sin(x*0.21+z*0.17);
                const h = %f;
                const fdx = -Math.sin(h), fdz = -Math.cos(h);
                const X = %f, Z = %f;
                return (hAt(X+fdx*0.35,Z+fdz*0.35)-hAt(X-fdx*0.35,Z-fdz*0.35))/0.7;
              })()
            """ % (heading, px, pz))
            results["slope"] = {
                "final_pos": [round(px, 2), round(py, 3), round(pz, 2)],
                "heading_deg": round(math.degrees(heading), 1),
                "root_pitch_rad": round(pitch, 3),
                "terrain_grade_along_facing": round(grade, 3),
                "aligned_sign_or_zero":
                    abs(pitch) > 0.02 or abs(grade) < 0.05,
                "pitch_matches_grade": (
                    math.copysign(1, pitch) == math.copysign(1, grade)
                    if abs(pitch) > 0.02 and abs(grade) > 0.05 else None
                ),
            }
            page.screenshot(path=f"{SHOTS}/task5-slope.png")

            # --- (e) fps --------------------------------------------------------
            fps = page.evaluate("""
              new Promise(res => {
                let n = 0; const t0 = performance.now();
                function cnt(t) {
                  n++;
                  if (t - t0 < 2000) requestAnimationFrame(cnt);
                  else res(Math.round(n * 1000 / (t - t0)));
                }
                requestAnimationFrame(cnt);
              })
            """)
            results["fps"] = {"value": fps, "ok": fps >= 58}
            page.screenshot(path=f"{SHOTS}/task5-idle.png")

            results["console_errors"] = errors[:10]
            print(json.dumps(results, indent=1))
            browser.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except Exception:
            server.kill()
    return 0


if __name__ == "__main__":
    sys.exit(main())
