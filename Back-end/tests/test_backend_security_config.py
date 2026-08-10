import os
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import remote_access  # noqa: E402
from llm import ollama_client  # noqa: E402


class ApiOriginSecurityTests(unittest.TestCase):
    def setUp(self):
        # Import tardio: outros testes configuram NEXUS_DATA_DIR durante a
        # coleta, antes de database.py fixar o caminho SQLite no processo.
        import app as backend_app

        self.backend_app = backend_app
        self.client = backend_app.app.test_client()

    def test_untrusted_origin_is_rejected_even_in_local_mode(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={"Origin": "https://malicious.example"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_dns_rebinding_same_origin_host_is_rejected_in_local_mode(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={
                    "Host": "attacker.example",
                    "Origin": "http://attacker.example",
                },
            )

        self.assertEqual(response.status_code, 403)

    def test_vite_localhost_origin_receives_scoped_cors(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={"Origin": "http://localhost:5174"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("Access-Control-Allow-Origin"),
            "http://localhost:5174",
        )
        self.assertEqual(response.headers.get("Vary"), "Origin")

    def test_capacitor_ios_origin_receives_scoped_cors(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={"Origin": "capacitor://localhost"},
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers.get("Access-Control-Allow-Origin"),
            "capacitor://localhost",
        )

    def test_untrusted_capacitor_origin_is_rejected(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={"Origin": "capacitor://attacker"},
            )

        self.assertEqual(response.status_code, 403)

    def test_electron_null_origin_remains_supported(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={
                    "Origin": "null",
                    "User-Agent": "Mozilla/5.0 Electron/39.0.0",
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "null")

    def test_browser_null_origin_is_rejected(self):
        with patch.object(remote_access, "REMOTE_MODE", False):
            response = self.client.get(
                "/api/auth/status",
                headers={
                    "Origin": "null",
                    "User-Agent": "Mozilla/5.0 Safari/605.1.15",
                },
            )

        self.assertEqual(response.status_code, 403)

    def test_preflight_from_untrusted_origin_is_rejected(self):
        response = self.client.options(
            "/api/sessions",
            headers={
                "Origin": "https://malicious.example",
                "Access-Control-Request-Method": "GET",
            },
        )

        self.assertEqual(response.status_code, 403)

    def test_config_never_exposes_master_token(self):
        with (
            patch.object(remote_access, "REMOTE_MODE", False),
            patch.object(remote_access, "AUTH_TOKEN", "master-secret-token"),
            patch.object(self.backend_app, "get_ollama_models", return_value=["test-model"]),
            patch.object(self.backend_app, "is_google_search_configured", return_value=False),
        ):
            response = self.client.get("/api/config")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertNotIn("mobile_token", payload)
        self.assertNotIn("master-secret-token", response.get_data(as_text=True))

    def test_device_token_is_visible_only_from_loopback(self):
        with (
            patch.object(remote_access, "REMOTE_MODE", True),
            patch.object(remote_access, "AUTH_TOKEN", "master-secret-token"),
        ):
            local_response = self.client.get(
                "/api/auth/device-token",
                environ_base={"REMOTE_ADDR": "127.0.0.1"},
            )
            lan_response = self.client.get(
                "/api/auth/device-token",
                environ_base={"REMOTE_ADDR": "192.168.1.45"},
            )

        self.assertEqual(local_response.status_code, 200)
        self.assertEqual(local_response.get_json()["token"], "master-secret-token")
        self.assertEqual(local_response.headers.get("Cache-Control"), "no-store")
        self.assertEqual(lan_response.status_code, 403)
        self.assertNotIn("master-secret-token", lan_response.get_data(as_text=True))

    def test_electron_can_create_local_session_without_mobile_token(self):
        with (
            patch.object(remote_access, "REMOTE_MODE", True),
            patch.object(remote_access, "AUTH_TOKEN", "master-secret-token"),
        ):
            response = self.client.post(
                "/api/auth/local",
                json={"label": "Buds Electron"},
                environ_base={"REMOTE_ADDR": "127.0.0.1"},
                headers={
                    "Origin": "null",
                    "User-Agent": "Mozilla/5.0 Electron/39.0.0",
                },
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["success"])
        self.assertEqual(payload["auth_mode"], "local")
        self.assertTrue(payload["access_token"])
        self.assertNotIn("master-secret-token", response.get_data(as_text=True))

    def test_lan_client_cannot_create_token_free_local_session(self):
        with (
            patch.object(remote_access, "REMOTE_MODE", True),
            patch.object(remote_access, "AUTH_TOKEN", "master-secret-token"),
        ):
            response = self.client.post(
                "/api/auth/local",
                json={"label": "remote-browser"},
                environ_base={"REMOTE_ADDR": "192.168.1.45"},
            )

        self.assertEqual(response.status_code, 403)
        self.assertNotIn("access_token", response.get_data(as_text=True))


class RemoteTokenPersistenceTests(unittest.TestCase):
    def test_non_loopback_host_automatically_enables_remote_auth(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            env = os.environ.copy()
            env.update({
                "NEXUS_DATA_DIR": tmp_dir,
                "NEXUS_HOST": "0.0.0.0",
                "NEXUS_REMOTE_MODE": "false",
                "PYTHONPATH": str(BACKEND_DIR),
            })
            result = subprocess.check_output(
                [
                    sys.executable,
                    "-c",
                    (
                        "import json, remote_access; "
                        "print(json.dumps({"
                        "'remote': remote_access.REMOTE_MODE, "
                        "'auth': bool(remote_access.AUTH_TOKEN)"
                        "}))"
                    ),
                ],
                cwd=BACKEND_DIR,
                env=env,
                text=True,
            ).strip()

        self.assertEqual(
            json.loads(result),
            {"remote": True, "auth": True},
        )

    def test_generated_token_is_persisted_in_configured_token_file(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            token_file = Path(tmp_dir) / ".nexus_remote_token"
            with (
                patch.object(remote_access, "AUTH_TOKEN", ""),
                patch.object(remote_access, "TOKEN_FILE", token_file),
            ):
                first = remote_access.get_or_create_mobile_token()
                second = remote_access.get_or_create_mobile_token()

            self.assertEqual(first, second)
            self.assertEqual(token_file.read_text(encoding="utf-8").strip(), first)
            self.assertEqual(token_file.stat().st_mode & 0o777, 0o600)

    def test_default_token_file_is_inside_nexus_data_dir(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            env = os.environ.copy()
            env["NEXUS_DATA_DIR"] = tmp_dir
            env["PYTHONPATH"] = str(BACKEND_DIR)
            result = subprocess.check_output(
                [
                    sys.executable,
                    "-c",
                    "import remote_access; print(remote_access.TOKEN_FILE)",
                ],
                cwd=BACKEND_DIR,
                env=env,
                text=True,
            ).strip()

        self.assertEqual(Path(result), Path(tmp_dir) / ".nexus_remote_token")


class OllamaUrlTests(unittest.TestCase):
    def setUp(self):
        ollama_client._MODELS_CACHE = []
        ollama_client._MODELS_CACHE_TS = 0.0

    def test_base_url_resolves_generate_and_tags_endpoints(self):
        self.assertEqual(
            ollama_client.resolve_ollama_urls("http://ollama.local:11434/"),
            (
                "http://ollama.local:11434",
                "http://ollama.local:11434/api/generate",
                "http://ollama.local:11434/api/tags",
            ),
        )

    def test_generate_endpoint_input_preserves_proxy_prefix(self):
        self.assertEqual(
            ollama_client.resolve_ollama_urls(
                "https://example.test/ollama/api/generate"
            ),
            (
                "https://example.test/ollama",
                "https://example.test/ollama/api/generate",
                "https://example.test/ollama/api/tags",
            ),
        )

    def test_model_listing_uses_resolved_tags_url(self):
        response = Mock(status_code=200)
        response.json.return_value = {"models": [{"name": "local-model"}]}
        with (
            patch.object(
                ollama_client,
                "OLLAMA_TAGS_URL",
                "https://ollama.test/prefix/api/tags",
            ),
            patch.object(ollama_client.requests, "get", return_value=response) as get,
        ):
            models = ollama_client.get_ollama_models()

        self.assertEqual(models, ["local-model"])
        get.assert_called_once_with(
            "https://ollama.test/prefix/api/tags",
            timeout=2,
        )

    def test_generation_uses_resolved_generate_url(self):
        response = Mock()
        with (
            patch.object(
                ollama_client,
                "OLLAMA_URL",
                "https://ollama.test/prefix/api/generate",
            ),
            patch.object(ollama_client.requests, "post", return_value=response) as post,
        ):
            result = ollama_client.post_ollama({"model": "test"}, stream=False)

        self.assertIs(result, response)
        post.assert_called_once_with(
            "https://ollama.test/prefix/api/generate",
            json={"model": "test"},
            stream=False,
            timeout=(8, 180),
        )

    def test_health_uses_same_resolved_tags_url(self):
        response = Mock(ok=True)
        with (
            patch.object(
                remote_access,
                "OLLAMA_TAGS_URL",
                "https://ollama.test/prefix/api/tags",
            ),
            patch.object(remote_access.requests, "get", return_value=response) as get,
        ):
            self.assertTrue(remote_access.is_ollama_online(timeout=0.25))

        get.assert_called_once_with(
            "https://ollama.test/prefix/api/tags",
            timeout=0.25,
        )


if __name__ == "__main__":
    unittest.main()
