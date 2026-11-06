import http.client
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from app.config import Settings


API_ROOT = Path(__file__).resolve().parents[1]


class StartupTests(unittest.TestCase):
    def run_module(self, working_directory: str, port: str | None) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(API_ROOT)
        if port is None:
            environment.pop("PORT", None)
        else:
            environment["PORT"] = port

        return subprocess.run(
            [sys.executable, "-m", "app.main"],
            cwd=working_directory,
            env=environment,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_missing_port_falls_back_to_documented_default(self) -> None:
        previous = os.environ.pop("PORT", None)
        try:
            settings_without_env_file = Settings(_env_file=None)
            self.assertEqual(settings_without_env_file.port, 8000)
        finally:
            if previous is not None:
                os.environ["PORT"] = previous

    def test_invalid_ports_fail_before_startup(self) -> None:
        invalid_ports = {
            "blank": "",
            "non_integer": "not-a-port",
            "fractional": "8123.5",
            "zero": "0",
            "above_range": "65536",
        }

        for label, port in invalid_ports.items():
            with self.subTest(port=label):
                result = self.run_module(str(API_ROOT), port)
                self.assertNotEqual(result.returncode, 0)

    def test_module_startup_binds_validated_port_and_serves_health(self) -> None:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]

        with (
            tempfile.TemporaryFile(mode="w+t", encoding="utf-8", errors="replace") as stdout,
            tempfile.TemporaryFile(mode="w+t", encoding="utf-8", errors="replace") as stderr,
        ):
            process = subprocess.Popen(
                [sys.executable, "-m", "app.main"],
                cwd=API_ROOT,
                env={**os.environ, "PYTHONPATH": str(API_ROOT), "PORT": str(port)},
                stdout=stdout,
                stderr=stderr,
            )

            def startup_output() -> str:
                try:
                    stdout.seek(0)
                    stdout_text = stdout.read()
                except Exception as error:
                    stdout_text = f"<unable to read stdout: {type(error).__name__}: {error}>"
                try:
                    stderr.seek(0)
                    stderr_text = stderr.read()
                except Exception as error:
                    stderr_text = f"<unable to read stderr: {type(error).__name__}: {error}>"
                return f"stdout:\n{stdout_text}\nstderr:\n{stderr_text}"

            def listener_snapshot() -> str:
                command = (
                    f"Get-NetTCPConnection -LocalPort {port} -ErrorAction Stop "
                    "| Select-Object LocalAddress,LocalPort,State,OwningProcess "
                    "| ConvertTo-Json -Compress"
                )
                try:
                    result = subprocess.run(
                        [
                            "powershell.exe",
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            command,
                        ],
                        capture_output=True,
                        text=True,
                        timeout=2,
                        check=False,
                    )
                    output = result.stdout.strip() or result.stderr.strip()
                    if result.returncode != 0:
                        return f"listener snapshot unavailable (exit {result.returncode}): {output}"
                    return output or "no listener entries returned"
                except Exception as error:
                    return (
                        "listener snapshot unavailable: "
                        f"{type(error).__name__}: {error}"
                    )

            def failure_diagnostics(
                phase: str, error: Exception | None
            ) -> str:
                try:
                    poll_status = process.poll()
                except Exception as poll_error:
                    poll_status = (
                        f"<poll failed: {type(poll_error).__name__}: {poll_error}>"
                    )
                last_error = (
                    f"{type(error).__name__}: {error}" if error is not None else "None"
                )
                return (
                    f"port={port}; child_poll_status={poll_status}; "
                    f"elapsed_seconds={time.monotonic() - start_time:.3f}; "
                    f"last_phase={phase}; last_exception={last_error}\n"
                    f"listener_snapshot={listener_snapshot()}\n{startup_output()}"
                )

            try:
                start_time = time.monotonic()
                deadline = time.monotonic() + 10
                last_error: Exception | None = None
                last_phase = "readiness polling"
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        self.fail(
                            "API exited before serving requests: "
                            f"{failure_diagnostics('child process', last_error)}"
                        )
                    connection = http.client.HTTPConnection(
                        "127.0.0.1", port, timeout=1
                    )
                    try:
                        last_phase = "connection/request"
                        connection.request("GET", "/health")
                        last_phase = "response headers"
                        response = connection.getresponse()
                        last_phase = "response body"
                        body = response.read()
                        if response.status != 200 or json.loads(body) != {"ok": True}:
                            self.fail(
                                "API returned an unexpected health response: "
                                f"status={response.status}; body={body!r}\n"
                                f"{failure_diagnostics(last_phase, None)}"
                            )
                        break
                    except OSError as error:
                        last_error = error
                        time.sleep(0.1)
                    finally:
                        connection.close()
                else:
                    self.fail(
                        "API did not serve health before the readiness deadline: "
                        f"{failure_diagnostics(last_phase, last_error)}"
                    )
            finally:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
