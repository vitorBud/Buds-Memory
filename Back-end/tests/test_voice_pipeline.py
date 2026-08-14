import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


class VoicePipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import app as backend_app

        cls.backend_app = backend_app
        cls.client = backend_app.app.test_client()

    def test_partial_transcription_reuses_local_provider_contract(self):
        with patch.object(self.backend_app, "transcribe_uploaded_audio", return_value="fala parcial"):
            response = self.client.post(
                "/api/voice/transcribe-partial",
                data={"audio": (io.BytesIO(b"audio-local"), "partial.webm")},
                content_type="multipart/form-data",
            )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["text"], "fala parcial")
        self.assertFalse(payload["final"])
        self.assertEqual(payload["provider"], "faster-whisper-local")

    def test_partial_transcription_requires_audio(self):
        response = self.client.post("/api/voice/transcribe-partial")
        self.assertEqual(response.status_code, 400)

    def test_uploaded_audio_is_removed_after_transcription(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "capture.webm"
            path.write_bytes(b"temporary")
            with (
                patch.object(self.backend_app, "save_uploaded_audio", return_value=path),
                patch.object(self.backend_app, "stt_local", return_value="texto final"),
            ):
                result = self.backend_app.transcribe_uploaded_audio(object())

            self.assertEqual(result, "texto final")
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
