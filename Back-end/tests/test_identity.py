import unittest

from app import get_direct_reply
from llm.prompt_builder import build_prompt
from performance import STANDARD_PATH


class BudsIdentityTests(unittest.TestCase):
    def test_direct_reply_keeps_buds_identity_with_deepseek_runtime(self):
        reply = get_direct_reply(
            "voce e o deepseek?",
            session_id=None,
            selected_model="deepseek-r1:14b",
            pipeline=STANDARD_PATH,
        )

        self.assertIsNotNone(reply)
        self.assertIn("Buds Memory", reply)
        self.assertIn("deepseek-r1:14b", reply)
        self.assertIn("motor local", reply.lower())
        self.assertNotIn("Vitor", reply)
        self.assertNotIn("sou o DeepSeek", reply)

    def test_creator_is_only_mentioned_when_asked(self):
        reply = get_direct_reply(
            "quem te criou?",
            session_id=None,
            selected_model="deepseek-r1:14b",
            pipeline=STANDARD_PATH,
        )

        self.assertIsNotNone(reply)
        self.assertIn("Buds Memory", reply)
        self.assertIn("Vitor", reply)

    def test_life_question_does_not_repeat_creator_or_model_brand(self):
        reply = get_direct_reply(
            "voce tem vida propria?",
            session_id=None,
            selected_model="qwen2.5:7b",
            pipeline=STANDARD_PATH,
        )

        self.assertIsNotNone(reply)
        self.assertIn("Não tenho vida própria", reply)
        self.assertNotIn("Vitor", reply)
        self.assertNotIn("qwen2.5:7b", reply)

    def test_current_version_question_is_short_and_runtime_only(self):
        reply = get_direct_reply(
            "qual e a sua versao atual?",
            session_id=None,
            selected_model="qwen2.5:7b",
            pipeline=STANDARD_PATH,
        )

        self.assertIsNotNone(reply)
        self.assertIn("Buds Memory", reply)
        self.assertIn("qwen2.5:7b", reply)
        self.assertNotIn("Vitor", reply)
        self.assertNotIn("Pipeline", reply)

    def test_prompt_separates_public_identity_from_ollama_model(self):
        prompt = build_prompt(
            "qual modelo voce esta usando?",
            pipeline=STANDARD_PATH,
            selected_model="deepseek-r1:14b",
        )

        self.assertIn("Buds Memory", prompt)
        self.assertIn("criado por Vitor", prompt)
        self.assertIn("deepseek-r1:14b", prompt)
        self.assertIn("apenas o motor local", prompt)
        self.assertIn("nunca diga 'sou DeepSeek'", prompt)

    def test_current_update_reply_knows_buds_map(self):
        reply = get_direct_reply(
            "o que há de novo nessa atualização?",
            session_id=None,
            selected_model="qwen2.5-coder:4b",
            pipeline=STANDARD_PATH,
        )

        self.assertIsNotNone(reply)
        self.assertIn("Buds Map", reply)
        self.assertIn("Context Engine", reply)
        self.assertIn("Buds Focus", reply)
        self.assertNotIn("talvez", reply.lower())

    def test_map_reply_is_product_aware_and_privacy_safe(self):
        reply = get_direct_reply(
            "você tem mapa? como ele funciona?",
            session_id=None,
            selected_model="qwen2.5-coder:4b",
            pipeline=STANDARD_PATH,
        )

        self.assertIsNotNone(reply)
        self.assertIn("Buds Map", reply)
        self.assertIn("coordenadas", reply.lower())
        self.assertIn("Qwen", reply)


if __name__ == "__main__":
    unittest.main()
