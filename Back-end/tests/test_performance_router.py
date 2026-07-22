import unittest

from performance import (
    DEEP_PATH,
    FAST_PATH,
    STANDARD_PATH,
    classify_pipeline,
    clip_context,
    options_for_pipeline,
    select_model_for_pipeline,
)
from llm.prompt_builder import build_prompt, infer_response_profile


class PerformanceRouterTests(unittest.TestCase):
    def test_small_talk_uses_fast_path(self):
        self.assertEqual(classify_pipeline("eai beleza?"), FAST_PATH)

    def test_memory_and_document_questions_keep_context(self):
        self.assertEqual(classify_pipeline("qual é o meu nome?"), STANDARD_PATH)
        self.assertEqual(classify_pipeline("Qual computador eu uso?"), STANDARD_PATH)
        self.assertEqual(classify_pipeline("o que você aprendeu do PDF anterior?"), STANDARD_PATH)

    def test_deep_work_keeps_deep_path(self):
        text = "faça uma auditoria completa do projeto inteiro e analise profundamente"
        self.assertEqual(classify_pipeline(text), DEEP_PATH)

    def test_fast_path_respects_selected_model(self):
        selected = select_model_for_pipeline(
            "qwen2.5-coder:14b",
            FAST_PATH,
            ["qwen2.5-coder:3b", "qwen2.5-coder:14b"],
        )
        self.assertEqual(selected, "qwen2.5-coder:14b")

    def test_pipeline_options_cap_context_and_generation(self):
        base = {"num_ctx": 8192, "num_predict": -1, "temperature": 0.42}
        options = options_for_pipeline(base, {"num_predict": 900}, FAST_PATH)

        self.assertLessEqual(options["num_ctx"], 2048)
        self.assertLessEqual(options["num_predict"], 160)
        self.assertEqual(options["temperature"], 0.42)

    def test_clip_context_preserves_empty_fast_context(self):
        self.assertEqual(clip_context("conteúdo grande", 0), "")
        self.assertEqual(clip_context("", 100), "")

    def test_fast_prompt_is_smaller_than_standard_prompt(self):
        fast = build_prompt("Oi, tudo bem?", pipeline=FAST_PATH)
        standard = build_prompt("Oi, tudo bem?", pipeline=STANDARD_PATH)

        self.assertLess(len(fast), len(standard) * 0.45)
        self.assertIn("Contrato rápido", fast)

    def test_resumidamente_overrides_explique_detail_profile(self):
        profile = infer_response_profile("Explique Clean Architecture resumidamente.")
        prompt = build_prompt("Explique Clean Architecture resumidamente.", pipeline=FAST_PATH)

        self.assertEqual(profile["name"], "curta")
        self.assertLessEqual(profile["num_predict"], 180)
        self.assertIn("1 ou 2 frases curtas", prompt)


if __name__ == "__main__":
    unittest.main()
