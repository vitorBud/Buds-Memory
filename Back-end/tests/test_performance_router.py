import unittest

from code_intent import is_code_request
from performance import (
    DEEP_PATH,
    FAST_PATH,
    STANDARD_PATH,
    budget_for_pipeline,
    classify_pipeline,
    clip_context,
    is_conversation_followup,
    model_size_billions,
    options_for_pipeline,
    requested_item_count,
    select_model_for_pipeline,
)
from llm.prompt_builder import build_prompt, infer_response_profile
from cognitive.conversation import answer_recent_assistant_reference


class PerformanceRouterTests(unittest.TestCase):
    def test_small_talk_uses_fast_path(self):
        self.assertEqual(classify_pipeline("eai beleza?"), FAST_PATH)

    def test_memory_and_document_questions_keep_context(self):
        self.assertEqual(classify_pipeline("qual é o meu nome?"), STANDARD_PATH)
        self.assertEqual(classify_pipeline("Qual computador eu uso?"), STANDARD_PATH)
        self.assertEqual(classify_pipeline("o que você aprendeu do PDF anterior?"), STANDARD_PATH)

    def test_reference_to_assistant_message_keeps_conversation_context(self):
        question = "mas antes disso, por que você me chamou de mané?"
        self.assertTrue(is_conversation_followup(question))
        self.assertEqual(classify_pipeline(question), STANDARD_PATH)

    def test_deep_work_keeps_deep_path(self):
        text = "faça uma auditoria completa do projeto inteiro e analise profundamente"
        self.assertEqual(classify_pipeline(text), DEEP_PATH)

    def test_explicit_list_count_gets_enough_budget_to_finish(self):
        question = "me de 5 ideias de projetos"
        profile = infer_response_profile(question)
        options_3b = options_for_pipeline(
            {"num_ctx": 8192, "num_predict": -1},
            profile,
            classify_pipeline(question),
            "qwen2.5-coder:3b",
        )
        options_7b = options_for_pipeline(
            {"num_ctx": 8192, "num_predict": -1},
            profile,
            classify_pipeline(question),
            "qwen2.5-coder:7b",
        )

        self.assertEqual(requested_item_count(question), 5)
        self.assertEqual(classify_pipeline(question), STANDARD_PATH)
        self.assertEqual(profile["name"], "lista")
        self.assertIn("exatamente 5 itens", profile["instruction"])
        self.assertGreaterEqual(options_3b["num_predict"], 470)
        self.assertGreaterEqual(options_7b["num_predict"], 560)

    def test_list_count_accepts_words_without_misreading_plain_statement(self):
        self.assertEqual(requested_item_count("pode me dar cinco ideias de projetos?"), 5)
        self.assertEqual(requested_item_count("tenho 5 projetos em andamento"), 0)

    def test_explicit_java_example_uses_standard_technical_path(self):
        question = "beleza, consegue me mandar um hello world em java?"
        profile = infer_response_profile(question)
        prompt = build_prompt(question, pipeline=classify_pipeline(question))

        self.assertTrue(is_code_request(question))
        self.assertEqual(classify_pipeline(question), STANDARD_PATH)
        self.assertEqual(profile["name"], "tecnica")
        self.assertIn("bloco Markdown", prompt)

    def test_language_name_alone_is_not_treated_as_code_request(self):
        self.assertFalse(is_code_request("Java é uma ilha da Indonésia?"))

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

    def test_models_7b_and_above_receive_larger_history_budget(self):
        small = budget_for_pipeline(FAST_PATH, "qwen2.5-coder:3b")
        capable = budget_for_pipeline(FAST_PATH, "qwen2.5-coder:7b")
        standard = budget_for_pipeline(STANDARD_PATH, "qwen2.5-coder:14b")

        self.assertEqual(model_size_billions("qwen2.5-coder:14b"), 14)
        self.assertGreater(capable["history_messages"], small["history_messages"])
        self.assertGreaterEqual(capable["num_ctx"], 4096)
        self.assertGreaterEqual(standard["history_messages"], 14)
        self.assertGreaterEqual(standard["num_ctx"], 8192)

    def test_clip_context_preserves_empty_fast_context(self):
        self.assertEqual(clip_context("conteúdo grande", 0), "")
        self.assertEqual(clip_context("", 100), "")

    def test_fast_prompt_is_smaller_than_standard_prompt(self):
        fast = build_prompt("Oi, tudo bem?", pipeline=FAST_PATH)
        standard = build_prompt("Oi, tudo bem?", pipeline=STANDARD_PATH)

        self.assertLess(len(fast), len(standard) * 0.45)
        self.assertIn("Contrato rápido", fast)
        self.assertIn("Não invente apelidos", fast)

    def test_resumidamente_overrides_explique_detail_profile(self):
        profile = infer_response_profile("Explique Clean Architecture resumidamente.")
        prompt = build_prompt("Explique Clean Architecture resumidamente.", pipeline=FAST_PATH)

        self.assertEqual(profile["name"], "curta")
        self.assertLessEqual(profile["num_predict"], 180)
        self.assertIn("1 ou 2 frases curtas", prompt)

    def test_followup_prompt_marks_previous_assistant_speech_as_factual(self):
        history = [
            {"sender": "user", "text": "o que você quer fazer hoje?"},
            {"sender": "ia", "text": "Só assistir no que você precisar, mané."},
            {"sender": "user", "text": "me ajuda a programar?"},
            {"sender": "ia", "text": "Claro! Qual é o problema específico?"},
        ]
        question = "mas antes disso, por que você me chamou de mané?"
        prompt = build_prompt(
            question,
            history=history,
            pipeline=STANDARD_PATH,
            selected_model="qwen2.5-coder:7b",
        )

        self.assertIn("CONTINUIDADE CONVERSACIONAL OBRIGATÓRIA", prompt)
        self.assertIn("Só assistir no que você precisar, mané.", prompt)
        self.assertIn("registro factual e cronológico", prompt)

    def test_exact_called_term_is_answered_only_when_grounded_in_history(self):
        history = [
            {"sender": "ia", "text": "Só assistir no que você precisar, mané."},
        ]
        grounded = answer_recent_assistant_reference(
            "por que você me chamou de mané?",
            history,
        )
        missing = answer_recent_assistant_reference(
            "por que você me chamou de professor?",
            history,
        )

        self.assertIn("realmente usei “mané”", grounded)
        self.assertIsNone(missing)


if __name__ == "__main__":
    unittest.main()
