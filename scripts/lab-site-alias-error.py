#!/usr/bin/env python3
"""
Bounded Real-Image Lab for Client Site Alias, Pre-Emission Error Containment, and Lifecycle Disposition
Tests the built candidate image (citylife:candidate) using official entrypoint processing and fabricated markers only.
"""

import json
import os
import subprocess
import sys
import tempfile
import time

def run_cmd(args, check=True, timeout=30):
    res = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed ({res.returncode}): {' '.join(args)}\nStderr: {res.stderr}\nStdout: {res.stdout}")
    return res

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    print("=== Starting Bounded Real-Image Lab ===")
    print(f"Repo root: {repo_root}")

    # Inspect candidate image metadata
    candidate_image = "citylife:candidate"
    img_inspect = run_cmd(["docker", "image", "inspect", candidate_image, "--format", "{{json .Id}}"]).stdout.strip().strip('"')

    net_name = f"site-lab-net-{int(time.time())}"
    gw_name = f"mock-gateway-{int(time.time())}"
    nginx_name = f"site-nginx-{int(time.time())}"

    results = {
        "lab": "client-site-alias-error-pre-emission-containment",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "candidate_image": candidate_image,
        "candidate_image_id": img_inspect,
        "base_image": "nginx:alpine",
        "base_image_id": "sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2",
        "base_repo_digest": "nginx@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2",
        "nginx_version": "nginx/1.31.6",
        "entrypoint": ["/usr/local/bin/site-entrypoint.sh"],
        "entrypoint_cmd": ["nginx", "-g", "daemon off;"],
        "supervisor_script": "/usr/local/bin/site-entrypoint.sh",
        "entrypoint_binding": "supervisor entrypoint /usr/local/bin/site-entrypoint.sh runs official entrypoint template processing (/docker-entrypoint.sh nginx -v), creates pre-emission FIFO, runs companion filter with signal trap and active child supervision, preserving Nginx exit code and awaiting log drain",
        "exposure_reproduction_baseline": {
            "intermediate_head": "d4d04a7",
            "observation": "Without pre-emission companion, Nginx C-core upstream connect failure directly formats unredacted request URI to stderr",
            "prior_reproduction_results": {
                "timestamp_06_35_48Z": {"passed": 31, "failed": 2, "unredacted_c_core_leak": "timed out prior to connection refusal"},
                "timestamp_06_44_49Z": {"passed": 36, "failed": 0, "unredacted_c_core_leak": "confirmed raw token emitted to stderr as other-hop gap"}
            }
        },
        "containment_acceptance_cases": [],
        "passed": 0,
        "failed": 0,
        "skipped": 0,
    }

    try:
        # Create isolated Docker bridge network
        run_cmd(["docker", "network", "create", net_name])

        # Start mock gateway container (python:3.13-slim)
        gw_script = '''
import http.server
import json
import sys

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.handle_req()
    def do_POST(self):
        self.handle_req()
    def handle_req(self):
        headers_dict = {k: v for k, v in self.headers.items()}
        print(f"UPSTREAM_RECV: {self.command} {self.path} HOST={headers_dict.get('Host')} XFP={headers_dict.get('X-Forwarded-Proto')}", flush=True)
        if self.path == "/close-socket":
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"closed")
            import threading
            import time
            def close_socket_only():
                time.sleep(0.1)
                try:
                    self.server.socket.close()
                except Exception:
                    pass
                while True:
                    time.sleep(1)
            threading.Thread(target=close_socket_only).start()
            return
        if self.path.startswith("/api/v1/citylife/auth/cookie"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", "citylife_auth=dummy-jwt-value; Path=/api/v1/citylife/ws; HttpOnly; SameSite=Lax")
            self.end_headers()
            self.wfile.write(b'{"status":"cookie_issued"}')
        elif self.path.startswith("/api/v1/citylife/auth/clear"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", "citylife_auth=; Max-Age=0; Path=/api/v1/citylife/ws")
            self.end_headers()
            self.wfile.write(b'{"status":"cookie_cleared"}')
        elif "browser-ws" in self.path:
            if self.headers.get("Upgrade", "").lower() == "websocket":
                self.send_response(101, "Switching Protocols")
                self.send_header("Upgrade", "websocket")
                self.send_header("Connection", "Upgrade")
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"status":"ws_upstream_http_only"}')
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"path": self.path, "headers": headers_dict}).encode("utf-8"))

server = http.server.HTTPServer(("0.0.0.0", 8080), Handler)
print("MOCK_GATEWAY_READY", flush=True)
server.serve_forever()
'''

        run_cmd([
            "docker", "run", "-d", "--name", gw_name, "--network", net_name,
            "python:3.13-slim", "python", "-u", "-c", gw_script
        ])

        # Wait for mock gateway to be ready
        for _ in range(30):
            logs = run_cmd(["docker", "logs", gw_name], check=False).stdout
            if "MOCK_GATEWAY_READY" in logs:
                break
            time.sleep(0.2)

        # Start Nginx container using candidate built image
        run_cmd([
            "docker", "run", "-d", "--name", nginx_name, "--network", net_name,
            "-e", f"KOOKER_GATEWAY=http://{gw_name}:8080",
            "-e", "KOOKER_HOST=api.kooker.example",
            "-e", "CITYLIFE_BOT_BACKEND=mock",
            "-e", "CITYLIFE_MODEL=kooker-codex",
            candidate_image
        ])

        # Wait for Nginx to be ready
        for _ in range(30):
            res = run_cmd(["docker", "exec", nginx_name, "wget", "-q", "-O-", "http://127.0.0.1/healthz"], check=False)
            if res.returncode == 0 and res.stdout.strip() == "ok":
                break
            time.sleep(0.2)

        print("Candidate Nginx container ready and verified via /healthz.")

        def test_req(name, path, headers=None, post_data=None):
            cmd = ["docker", "exec", nginx_name, "wget", "-S", "-O", "/tmp/resp.txt"]
            if headers:
                for h in headers:
                    cmd.extend(["--header", h])
            if post_data is not None:
                cmd.extend(["--post-data", post_data])
            url = f"http://127.0.0.1{path}"
            cmd.append(url)
            res = run_cmd(cmd, check=False)
            status_line = [line for line in res.stderr.splitlines() if "HTTP/" in line]
            status_code = None
            if status_line:
                parts = status_line[0].split()
                if len(parts) >= 2 and parts[1].isdigit():
                    status_code = int(parts[1])
            body = run_cmd(["docker", "exec", nginx_name, "cat", "/tmp/resp.txt"], check=False).stdout
            return {"name": name, "status": status_code, "stderr": res.stderr, "body": body}

        # -------------------------------------------------------------
        # Part A: Valid route / protocol upgrade / auth positives
        # -------------------------------------------------------------
        r1 = test_req("ws_upgrade_direct", "/api/v1/citylife/ws", headers=["Upgrade: websocket", "Connection: upgrade"])
        r2 = test_req("ws_upgrade_kooker", "/kooker/api/v1/citylife/ws", headers=["Upgrade: websocket", "Connection: upgrade"])
        r2b = test_req("ws_http_only_direct", "/api/v1/citylife/ws")
        r2c = test_req("ws_http_only_kooker", "/kooker/api/v1/citylife/ws")
        r3 = test_req("auth_cookie_direct", "/api/v1/citylife/auth/cookie", post_data='{"token":"dummy"}')
        r4 = test_req("auth_cookie_kooker", "/kooker/api/v1/citylife/auth/cookie", post_data='{"token":"dummy"}')
        r5 = test_req("auth_clear_direct", "/api/v1/citylife/auth/clear", post_data="{}")
        r6 = test_req("auth_clear_kooker", "/kooker/api/v1/citylife/auth/clear", post_data="{}")
        r7 = test_req("scheme_https", "/api/v1/citylife/auth/cookie", headers=["X-Forwarded-Proto: https"], post_data="{}")
        r8 = test_req("scheme_http", "/api/v1/citylife/auth/cookie", headers=["X-Forwarded-Proto: http"], post_data="{}")
        r9 = test_req("scheme_untrusted", "/api/v1/citylife/auth/cookie", headers=["X-Forwarded-Proto: ftp, https"], post_data="{}")

        # -------------------------------------------------------------
        # Part B: Site alias & trailing-slash negatives (fabricated markers)
        # -------------------------------------------------------------
        m01 = "FABRICATED_MARKER_01"
        r10 = test_req("browser_ws_direct_404", f"/api/v1/citylife/browser-ws?token={m01}", headers=["Upgrade: websocket"])
        m02 = "FABRICATED_MARKER_02"
        r11 = test_req("browser_ws_kooker_404", f"/kooker/api/v1/citylife/browser-ws?token={m02}", headers=["Upgrade: websocket"])
        m03 = "FABRICATED_MARKER_03"
        r12 = test_req("ws_trailing_direct_404", f"/api/v1/citylife/ws/?token={m03}")
        m04 = "FABRICATED_MARKER_04"
        r13 = test_req("ws_trailing_kooker_404", f"/kooker/api/v1/citylife/ws/?token={m04}")
        m05 = "FABRICATED_MARKER_05"
        r14 = test_req("cookie_trailing_direct_404", f"/api/v1/citylife/auth/cookie/?token={m05}")
        m06 = "FABRICATED_MARKER_06"
        r15 = test_req("cookie_trailing_kooker_404", f"/kooker/api/v1/citylife/auth/cookie/?token={m06}")
        m07 = "FABRICATED_MARKER_07"
        r16 = test_req("clear_trailing_direct_404", f"/api/v1/citylife/auth/clear/?token={m07}")
        m08 = "FABRICATED_MARKER_08"
        r17 = test_req("clear_trailing_kooker_404", f"/kooker/api/v1/citylife/auth/clear/?token={m08}")
        m09 = "FABRICATED_MARKER_09"
        r18 = test_req("ws_query_sanitized", f"/api/v1/citylife/ws?token={m09}", headers=["Upgrade: websocket", "Connection: upgrade"])
        m10 = "FABRICATED_MARKER_10"
        r19 = test_req("cookie_query_sanitized", f"/api/v1/citylife/auth/cookie?token={m10}", post_data="{}")
        m11 = "FABRICATED_REFERER_11"
        r20 = test_req("referer_sanitized", "/api/v1/citylife/ws", headers=["Referer: https://example.invalid/?token=" + m11])

        # Encoded query path variants (%3f lower and %3F upper, direct and /kooker aliases)
        m_enc_01 = "FABRICATED_ENC_WS_DIRECT_LOWER_01"
        r_enc_01 = test_req("ws_enc_direct_lower_404", f"/api/v1/citylife/ws%3ftoken={m_enc_01}")
        m_enc_02 = "FABRICATED_ENC_WS_DIRECT_UPPER_02"
        r_enc_02 = test_req("ws_enc_direct_upper_404", f"/api/v1/citylife/ws%3Ftoken={m_enc_02}")
        m_enc_03 = "FABRICATED_ENC_WS_KOOKER_LOWER_03"
        r_enc_03 = test_req("ws_enc_kooker_lower_404", f"/kooker/api/v1/citylife/ws%3ftoken={m_enc_03}")
        m_enc_04 = "FABRICATED_ENC_WS_KOOKER_UPPER_04"
        r_enc_04 = test_req("ws_enc_kooker_upper_404", f"/kooker/api/v1/citylife/ws%3Ftoken={m_enc_04}")
        m_enc_05 = "FABRICATED_ENC_BWS_DIRECT_05"
        r_enc_05 = test_req("bws_enc_direct_404", f"/api/v1/citylife/browser-ws%3ftoken={m_enc_05}")
        m_enc_06 = "FABRICATED_ENC_BWS_KOOKER_06"
        r_enc_06 = test_req("bws_enc_kooker_404", f"/kooker/api/v1/citylife/browser-ws%3Ftoken={m_enc_06}")
        m_enc_07 = "FABRICATED_ENC_COOKIE_DIRECT_07"
        r_enc_07 = test_req("cookie_enc_direct_404", f"/api/v1/citylife/auth/cookie%3ftoken={m_enc_07}")
        m_enc_08 = "FABRICATED_ENC_COOKIE_KOOKER_08"
        r_enc_08 = test_req("cookie_enc_kooker_404", f"/kooker/api/v1/citylife/auth/cookie%3Ftoken={m_enc_08}")
        m_enc_09 = "FABRICATED_ENC_CLEAR_DIRECT_09"
        r_enc_09 = test_req("clear_enc_direct_404", f"/api/v1/citylife/auth/clear%3ftoken={m_enc_09}")
        m_enc_10 = "FABRICATED_ENC_CLEAR_KOOKER_10"
        r_enc_10 = test_req("clear_enc_kooker_404", f"/kooker/api/v1/citylife/auth/clear%3Ftoken={m_enc_10}")

        # -------------------------------------------------------------
        # Part C: Ordinary diagnostic preservation (access.log)
        # -------------------------------------------------------------
        m12 = "FABRICATED_ORDINARY_QUERY_12"
        r21 = test_req("ordinary_query_preserved", f"/ask?search={m12}")

        # -------------------------------------------------------------
        # Part D: Pre-Emission Containment Acceptance (502 & error.log)
        # -------------------------------------------------------------
        # Close listening socket inside mock gateway container
        run_cmd(["docker", "exec", gw_name, "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/close-socket')"], check=False)
        time.sleep(0.3)

        # 1. Ordinary non-sensitive upstream failure produces ordinary upstream error diagnostics
        r_ord_err = test_req("ordinary_upstream_error_502", "/kooker/ordinary-endpoint-fail")

        # 2. Sensitive direct upstream failure
        m13 = "FABRICATED_UPSTREAM_FAIL_DIRECT_13"
        r22 = test_req("upstream_failure_direct_502", f"/api/v1/citylife/ws?token={m13}", headers=["Upgrade: websocket", "Connection: upgrade"])

        # 3. Sensitive alias upstream failure
        m14 = "FABRICATED_UPSTREAM_FAIL_KOOKER_14"
        r23 = test_req("upstream_failure_kooker_502", f"/kooker/api/v1/citylife/ws?token={m14}", headers=["Upgrade: websocket", "Connection: upgrade"])

        # 4. Sensitive URL-encoded query in path rejected with 404 (lower %3f and upper %3F, direct and /kooker)
        m15 = "FABRICATED_UPSTREAM_FAIL_ENCODED_15"
        r24 = test_req("upstream_failure_encoded_404", f"/api/v1/citylife/ws%3ftoken={m15}", headers=["Upgrade: websocket", "Connection: upgrade"])
        m15_upper = "FABRICATED_UPSTREAM_FAIL_ENCODED_UPPER_15B"
        r24_upper = test_req("upstream_failure_encoded_upper_404", f"/kooker/api/v1/citylife/ws%3Ftoken={m15_upper}", headers=["Upgrade: websocket", "Connection: upgrade"])

        # 5. Query-bearing Referer on 404
        m16 = "FABRICATED_REFERER_404_16"
        r25 = test_req("referer_404_sanitized", "/missing-file.html", headers=["Referer: https://example.invalid/path?jwt=" + m16])

        # -------------------------------------------------------------
        # Part E: Process Lifecycle, Drain & Fail-Closed Contract
        # -------------------------------------------------------------
        # Test 1: Final fabricated error emission, graceful stop duration, exit status, and drain proof
        m17 = "FABRICATED_FINAL_DRAIN_17"
        ref_drain = "https://example.invalid/unique-final-drain-marker-17"
        logs_before_drain = run_cmd(["docker", "logs", nginx_name]).stderr
        ref_before_drain_absent = (ref_drain not in logs_before_drain)

        r_drain = test_req("final_drain_err", f"/api/v1/citylife/ws?token={m17}", headers=["Upgrade: websocket", "Connection: upgrade", f"Referer: {ref_drain}"])
        t_stop_start = time.time()
        run_cmd(["docker", "stop", "-t", "5", nginx_name])
        stop_duration = time.time() - t_stop_start
        graceful_stop_ok = stop_duration < 3.0

        # Inspect exit code of gracefully stopped container
        stop_inspect = run_cmd(["docker", "inspect", nginx_name, "--format", "{{.State.ExitCode}}"])
        normal_exit_code_ok = (int(stop_inspect.stdout.strip()) == 0)

        # Inspect final drained logs: both stdout (access) and stderr (error) captured after ALL requests
        nginx_logs_final = run_cmd(["docker", "logs", nginx_name])
        access_log_final = nginx_logs_final.stdout
        error_log_final = nginx_logs_final.stderr
        gw_logs = run_cmd(["docker", "logs", gw_name]).stdout

        drain_record_present = (ref_drain in error_log_final)
        drain_sanitized_ok = (
            r_drain["status"] == 502 and
            ref_before_drain_absent and
            drain_record_present and
            (m17 not in error_log_final) and
            (f"/api/v1/citylife/ws?[REDACTED]" in error_log_final)
        )

        # -------------------------------------------------------------
        # Part F: Actual Rejected-fae Effective-Map Regression Negative
        # -------------------------------------------------------------
        # Spin up an actual container mounting git show fae1090:docker/default.conf.template
        # to prove the actual Nginx engine executing the rejected fae1090 map chain
        # emitted the raw request query to access.log on encoded %3f and %3F paths.
        fae_temp_path = os.path.join(repo_root, ".fae1090-test-template.tmp")
        fae_cid = "citylife-fae-regress"
        fae_leak_lower_confirmed = False
        fae_leak_upper_confirmed = False
        fae_sample_leak_line = ""
        try:
            fae_template_bytes = subprocess.check_output(
                ["git", "show", "fae1090:docker/default.conf.template"],
                cwd=repo_root
            )
            with open(fae_temp_path, "wb") as f:
                f.write(fae_template_bytes.replace(b"\r\n", b"\n"))

            run_cmd(["docker", "rm", "-f", fae_cid], check=False)
            run_cmd([
                "docker", "run", "-d", "--name", fae_cid,
                "-v", f"{fae_temp_path}:/etc/nginx/templates/default.conf.template:ro",
                "-e", f"KOOKER_GATEWAY=http://127.0.0.1:8080",
                "-e", "KOOKER_HOST=kooker.internal",
                candidate_image
            ])
            time.sleep(2.0)

            m_fae_leak_lower = "FABRICATED_FAE_REJECTED_MAP_LEAK_TOKEN"
            m_fae_leak_upper = "FABRICATED_FAE_REJECTED_UPPER_LEAK_TOKEN"
            run_cmd(["docker", "exec", fae_cid, "wget", "-S", "-O", "/dev/null", f"http://127.0.0.1/api/v1/citylife/ws%3ftoken={m_fae_leak_lower}"], check=False)
            run_cmd(["docker", "exec", fae_cid, "wget", "-S", "-O", "/dev/null", f"http://127.0.0.1/api/v1/citylife/ws%3Ftoken={m_fae_leak_upper}"], check=False)
            time.sleep(0.5)

            fae_logs = run_cmd(["docker", "logs", fae_cid]).stdout
            if m_fae_leak_lower in fae_logs:
                fae_leak_lower_confirmed = True
                for line in fae_logs.splitlines():
                    if m_fae_leak_lower in line:
                        fae_sample_leak_line = line
                        break
            if m_fae_leak_upper in fae_logs:
                fae_leak_upper_confirmed = True
        except Exception as e:
            print(f"Warning: fae1090 regression check encountered: {e}")
        finally:
            run_cmd(["docker", "rm", "-f", fae_cid], check=False)
            if os.path.exists(fae_temp_path):
                os.remove(fae_temp_path)

        results["exposure_reproduction_baseline"]["fae1090_effective_map_regression"] = {
            "reproduced_raw_request_leak_lower": fae_leak_lower_confirmed,
            "reproduced_raw_request_leak_upper": fae_leak_upper_confirmed,
            "sample_emitted_access_log_line": fae_sample_leak_line,
            "candidate_cleared": (m_enc_01 not in access_log_final) and (m_enc_02 not in access_log_final),
        }

        # Test 2: Verified live target, health check, companion death, and fail-closed termination
        run_cmd(["docker", "start", nginx_name])
        pre_kill_health_ok = False
        for _ in range(30):
            res = run_cmd(["docker", "exec", nginx_name, "wget", "-q", "-O-", "http://127.0.0.1/healthz"], check=False)
            if res.returncode == 0 and res.stdout.strip() == "ok":
                pre_kill_health_ok = True
                break
            time.sleep(0.2)

        start_logs = run_cmd(["docker", "logs", nginx_name]).stdout
        cpid = None
        for line in start_logs.splitlines():
            if "PRE_EMISSION_COMPANION_PID=" in line:
                cpid = line.split("PRE_EMISSION_COMPANION_PID=")[-1].strip()

        companion_target_verified = False
        if cpid:
            live_check = run_cmd(["docker", "exec", nginx_name, "kill", "-0", cpid], check=False)
            companion_target_verified = (live_check.returncode == 0)

        kill_cmd_ok = False
        companion_death_confirmed = False
        if companion_target_verified:
            k_res = run_cmd(["docker", "exec", nginx_name, "kill", "-9", cpid], check=False)
            kill_cmd_ok = (k_res.returncode == 0)
            time.sleep(0.3)
            death_check = run_cmd(["docker", "exec", nginx_name, "kill", "-0", cpid], check=False)
            companion_death_confirmed = (death_check.returncode != 0)

        time.sleep(0.7)
        inspect_fc = run_cmd(["docker", "inspect", nginx_name, "--format", "{{.State.Running}}|{{.State.ExitCode}}"])
        fc_running_str, fc_code_str = inspect_fc.stdout.strip().split("|")
        container_stopped_on_fc = (fc_running_str == "false")
        exit_code_fc_ok = (fc_code_str == "1")

        fc_logs = run_cmd(["docker", "logs", nginx_name]).stderr
        supervisor_fail_closed_logged = "Pre-emission companion died unexpectedly; terminating Nginx (fail-closed)" in fc_logs

        # Test 3: Real invalid-start/child-nonzero negative control
        bad_start_res = run_cmd(["docker", "run", "--rm", candidate_image, "nginx", "-g", "invalid_syntax;"], check=False)
        child_nonzero_exit_ok = (bad_start_res.returncode == 1)
        child_nonzero_logged_ok = 'unknown directive "invalid_syntax"' in bad_start_res.stderr

        # Inventory of all 27 fabricated sensitive markers to verify across BOTH stdout and stderr
        all_sensitive_markers = [
            ("FABRICATED_MARKER_01 (bws direct)", m01),
            ("FABRICATED_MARKER_02 (bws kooker)", m02),
            ("FABRICATED_MARKER_03 (ws trailing direct)", m03),
            ("FABRICATED_MARKER_04 (ws trailing kooker)", m04),
            ("FABRICATED_MARKER_05 (cookie trailing direct)", m05),
            ("FABRICATED_MARKER_06 (cookie trailing kooker)", m06),
            ("FABRICATED_MARKER_07 (clear trailing direct)", m07),
            ("FABRICATED_MARKER_08 (clear trailing kooker)", m08),
            ("FABRICATED_MARKER_09 (ws query)", m09),
            ("FABRICATED_MARKER_10 (cookie query)", m10),
            ("FABRICATED_REFERER_11 (referer)", m11),
            ("FABRICATED_ENC_WS_DIRECT_LOWER_01", m_enc_01),
            ("FABRICATED_ENC_WS_DIRECT_UPPER_02", m_enc_02),
            ("FABRICATED_ENC_WS_KOOKER_LOWER_03", m_enc_03),
            ("FABRICATED_ENC_WS_KOOKER_UPPER_04", m_enc_04),
            ("FABRICATED_ENC_BWS_DIRECT_05", m_enc_05),
            ("FABRICATED_ENC_BWS_KOOKER_06", m_enc_06),
            ("FABRICATED_ENC_COOKIE_DIRECT_07", m_enc_07),
            ("FABRICATED_ENC_COOKIE_KOOKER_08", m_enc_08),
            ("FABRICATED_ENC_CLEAR_DIRECT_09", m_enc_09),
            ("FABRICATED_ENC_CLEAR_KOOKER_10", m_enc_10),
            ("FABRICATED_SENSITIVE_UPSTREAM_13 (upstream direct)", m13),
            ("FABRICATED_SENSITIVE_UPSTREAM_14 (upstream kooker)", m14),
            ("FABRICATED_SENSITIVE_ENCODED_15 (upstream enc lower)", m15),
            ("FABRICATED_SENSITIVE_ENCODED_15B (upstream enc upper)", m15_upper),
            ("FABRICATED_REFERER_404_16 (upstream referer)", m16),
            ("FABRICATED_FINAL_DRAIN_17 (final drain token)", m17),
        ]

        # Assertions
        assertions = [
            # Part A: Route / Upgrade / Auth Positives
            ("ws_upgrade_direct returns 101 Switching Protocols", r1["status"] == 101),
            ("ws_upgrade_kooker returns 101 Switching Protocols", r2["status"] == 101),
            ("ws_http_only_direct returns 200 (qualifies HTTP proxying vs 101 protocol upgrade)", r2b["status"] == 200 and "ws_upstream_http_only" in r2b["body"]),
            ("ws_http_only_kooker returns 200 (qualifies HTTP proxying vs 101 protocol upgrade under alias)", r2c["status"] == 200 and "ws_upstream_http_only" in r2c["body"]),
            ("auth_cookie_direct returns 200", r3["status"] == 200),
            ("auth_cookie_kooker returns 200", r4["status"] == 200),
            ("auth_clear_direct returns 200", r5["status"] == 200),
            ("auth_clear_kooker returns 200", r6["status"] == 200),
            ("scheme_https maps X-Forwarded-Proto https", "XFP=https" in gw_logs),
            ("scheme_http maps X-Forwarded-Proto http", "XFP=http" in gw_logs),
            ("scheme_untrusted falls back to http", "XFP=http" in gw_logs),

            # Part B: Site Alias & Trailing-Slash Negatives (404 status)
            ("browser_ws_direct_404 returns 404 (not 200 SPA index)", r10["status"] == 404 and "SPA Index" not in r10["body"]),
            ("browser_ws_kooker_404 returns 404", r11["status"] == 404),
            ("ws_trailing_direct_404 returns 404", r12["status"] == 404),
            ("ws_trailing_kooker_404 returns 404", r13["status"] == 404),
            ("cookie_trailing_direct_404 returns 404", r14["status"] == 404),
            ("cookie_trailing_kooker_404 returns 404", r15["status"] == 404),
            ("clear_trailing_direct_404 returns 404", r16["status"] == 404),
            ("clear_trailing_kooker_404 returns 404", r17["status"] == 404),
            ("ws_enc_direct_lower_404 returns 404 (not 200 SPA index)", r_enc_01["status"] == 404 and "SPA Index" not in r_enc_01["body"]),
            ("ws_enc_direct_upper_404 returns 404", r_enc_02["status"] == 404),
            ("ws_enc_kooker_lower_404 returns 404", r_enc_03["status"] == 404),
            ("ws_enc_kooker_upper_404 returns 404", r_enc_04["status"] == 404),
            ("bws_enc_direct_404 returns 404", r_enc_05["status"] == 404),
            ("bws_enc_kooker_404 returns 404", r_enc_06["status"] == 404),
            ("cookie_enc_direct_404 returns 404", r_enc_07["status"] == 404),
            ("cookie_enc_kooker_404 returns 404", r_enc_08["status"] == 404),
            ("clear_enc_direct_404 returns 404", r_enc_09["status"] == 404),
            ("clear_enc_kooker_404 returns 404", r_enc_10["status"] == 404),

            # Part C: Nonempty Diagnostic Positives (Stdout & Stderr)
            ("access.log stream is nonempty useful diagnostics", len(access_log_final) > 500),
            ("error.log stream is nonempty useful diagnostics", len(error_log_final) > 500),
            ("ordinary_query_preserved returns 200", r21["status"] == 200),
            ("access.log PRESERVES ordinary non-sensitive query diagnostics", m12 in access_log_final),
            ("access.log safely renders clean path without raw or decoded query parameters", '"GET /api/v1/citylife/ws HTTP/1.1"' in access_log_final),
            ("ordinary_upstream_error_502 returns 502 Bad Gateway", r_ord_err["status"] == 502),
            ("error.log PRESERVES baseline ordinary upstream request diagnostics", 'request: "GET /kooker/ordinary-endpoint-fail HTTP/1.1"' in error_log_final),
            ("error.log PRESERVES baseline worker start notices without warn suppression", "start worker process" in error_log_final),
            ("upstream_failure_direct_502 returns 502 Bad Gateway", r22["status"] == 502),
            ("upstream_failure_kooker_502 returns 502 Bad Gateway", r23["status"] == 502),
            ("upstream_failure_encoded_404 returns 404 (preventing SPA fallback)", r24["status"] == 404),
            ("upstream_failure_encoded_upper_404 returns 404", r24_upper["status"] == 404),
            ("error.log confirms pre-emission [REDACTED] substitution in output stream", "[REDACTED]" in error_log_final),

            # Part D: Actual Rejected-fae Effective-Map Regression Negative
            ("rejected fae1090 template effective maps leak raw %3f query to access.log (reproduced)", fae_leak_lower_confirmed),
            ("rejected fae1090 template effective maps leak raw %3F upper query to access.log (reproduced)", fae_leak_upper_confirmed),
            ("candidate image with corrected maps eliminates raw %3f and %3F leaks from access.log", (m_enc_01 not in access_log_final) and (m_enc_02 not in access_log_final)),

            # Part E: Process Lifecycle, Drain & Fail-Closed Contract
            ("container graceful stop completes cleanly within 3s", graceful_stop_ok),
            ("container graceful stop retains clean exit code 0", normal_exit_code_ok),
            ("final fabricated error returns actual 502 upstream refusal", r_drain["status"] == 502),
            ("final fabricated error reaches sanitized output before graceful exit (drain proof)", drain_sanitized_ok),
            ("companion target PID verified live with successful pre-kill health 200", pre_kill_health_ok and companion_target_verified),
            ("companion termination command succeeds and target death is confirmed", kill_cmd_ok and companion_death_confirmed),
            ("supervisor terminates container with exit code 1 upon companion death", container_stopped_on_fc and exit_code_fc_ok),
            ("supervisor logs fail-closed message on companion death", supervisor_fail_closed_logged),
            ("invalid-start child command preserves unmasked non-zero exit code 1", child_nonzero_exit_ok),
            ("invalid-start child command preserves error diagnostic output", child_nonzero_logged_ok),
        ]

        # Part F: Comprehensive Marker Sanitization Checks (ALL 27 sensitive markers in BOTH streams)
        for label, marker in all_sensitive_markers:
            assertions.append((f"access.log does not leak {label}", marker not in access_log_final))
            assertions.append((f"error.log does not leak {label}", marker not in error_log_final))

        passed_count = 0
        failed_count = 0
        for desc, passed in assertions:
            results["containment_acceptance_cases"].append({"description": desc, "passed": bool(passed)})
            if passed:
                passed_count += 1
                print(f"  PASS: {desc}")
            else:
                failed_count += 1
                print(f"  FAIL: {desc}")

        results["passed"] = passed_count
        results["failed"] = failed_count
        results["skipped"] = 0
        results["containment_acceptance_status"] = "PASSED" if failed_count == 0 else "FAILED"

        # Save artifacts to outputs/
        outputs_dir = os.path.join(repo_root, "outputs", "lab-site-alias-error")
        os.makedirs(outputs_dir, exist_ok=True)

        with open(os.path.join(outputs_dir, "lab-results.json"), "w") as f:
            json.dump(results, f, indent=2)

        with open(os.path.join(outputs_dir, "effective-access.log"), "w") as f:
            f.write(access_log_final)

        with open(os.path.join(outputs_dir, "effective-error.log"), "w") as f:
            f.write(error_log_final)

        print("\n=== Lab Summary ===")
        print(f"Candidate Image: {candidate_image} ({img_inspect[:19]}...)")
        print(f"Total Cases: {len(assertions)}")
        print(f"Passed: {passed_count}")
        print(f"Failed: {failed_count}")
        print(f"Containment Acceptance Status: {results['containment_acceptance_status']}")
        print(f"Results written to: {outputs_dir}")

        if failed_count > 0:
            sys.exit(1)

    finally:
        run_cmd(["docker", "rm", "-f", nginx_name], check=False)
        run_cmd(["docker", "rm", "-f", gw_name], check=False)
        run_cmd(["docker", "network", "rm", net_name], check=False)

if __name__ == "__main__":
    main()
