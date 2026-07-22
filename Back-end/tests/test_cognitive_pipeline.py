import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


TEST_DATA_DIR = Path(tempfile.mkdtemp(prefix="aether-cognitive-tests-"))
os.environ["NEXUS_DATA_DIR"] = str(TEST_DATA_DIR)
sqlite3.connect(TEST_DATA_DIR / "chat_history.db").close()

import database  # noqa: E402
import database_v2  # noqa: E402
from cognitive import codebase_indexer, conversation, memory, rag, user_profile  # noqa: E402


def setUpModule():
    database.init_db()
    database_v2.migrate()


class CognitivePipelineTests(unittest.TestCase):
    def setUp(self):
        self.session = database.create_session("Teste cognitivo")
        self.session_id = self.session["id"]

    def test_profile_facts_become_core_memory_context(self):
        database.add_message(self.session_id, "user", "Meu nome é Vitor e meu projeto Aether Memory.")
        saved = user_profile.update_from_text(
            "Meu nome é Vitor e meu projeto Aether Memory.",
            session_id=self.session_id,
        )

        self.assertTrue(saved)
        context = conversation.build_conversation_context(
            "qual meu nome?",
            session_id=self.session_id,
            history=database.get_recent_session_messages(self.session_id),
        )

        self.assertIn("Nome: Vitor", context["context"])
        self.assertIn("Core Memory", context["context"])

    def test_vague_pdf_reference_resolves_latest_imported_source(self):
        database.add_message(self.session_id, "user", "Eu estava estudando hooks do React.")
        database.add_knowledge_source(
            session_id=self.session_id,
            title="Guia antigo de Python",
            source_type="pdf",
            source_name="python.pdf",
            summary="Material antigo sobre Python.",
            content="Python para automação.",
            topics=["Python"],
        )
        database.add_knowledge_source(
            session_id=self.session_id,
            title="Manual React Hooks",
            source_type="pdf",
            source_name="react-hooks.pdf",
            summary="Material sobre useState, useEffect e componentes React.",
            content="React Hooks usam estado e efeitos.",
            topics=["React", "Hooks", "useState"],
        )

        rewritten = conversation.rewrite_query(
            "o que o pdf anterior fala sobre isso?",
            history=database.get_recent_session_messages(self.session_id),
            session_id=self.session_id,
        )

        self.assertIn("Manual React Hooks", rewritten)
        self.assertIn("referente provável", rewritten)
        self.assertIn("React", rewritten)

    def test_intent_detection_handles_typos_and_troubleshooting_priority(self):
        interpretation = conversation.interpret_user_text("pyhton ta dando ruim")
        intent = conversation.detect_intent("pyhton ta dando ruim", interpretation)

        self.assertEqual(intent["primary"], "TROUBLESHOOTING")
        self.assertTrue(any(item["correction"] == "Python" for item in interpretation["typos"]))

    def test_rag_and_codebase_indexer_smoke(self):
        source = database.add_knowledge_source(
            session_id=self.session_id,
            title="Guia Python",
            source_type="pdf",
            source_name="python.pdf",
            summary="Guia sobre Python, APIs e automação.",
            content=(
                "Python é usado para automação, APIs Flask e análise de dados. "
                "O material explica criação de rotas, organização de scripts, leitura de arquivos "
                "e boas práticas para construir serviços backend locais."
            ),
            topics=["Python", "APIs", "Flask"],
        )
        indexed = rag.index_document(source["id"], source["content"], session_id=self.session_id)
        self.assertGreaterEqual(indexed, 1)
        rag_context = rag.build_rag_context("o que o pdf de python ensina?", session_id=self.session_id)
        self.assertIn("Python", rag_context)

        with tempfile.TemporaryDirectory() as project_dir:
            service = Path(project_dir) / "service.py"
            service.write_text("def login(user):\n    return user\n", encoding="utf-8")
            result = codebase_indexer.index_codebase(project_dir, max_files=10)
            matches = codebase_indexer.search_codebase("onde está a função login?", project_root=project_dir)

        self.assertEqual(result["files_scanned"], 1)
        self.assertGreaterEqual(result["records_indexed"], 1)
        self.assertTrue(any(match.get("symbol_name") == "login" for match in matches))

    def test_core_memory_delete_requires_force(self):
        item = memory.save_memory(
            "O usuário prefere respostas objetivas.",
            session_id=self.session_id,
            memory_type="long",
            importance=0.95,
            tags=["perfil"],
            is_core=True,
            locked=True,
            user_confirmed=True,
        )

        with self.assertRaises(ValueError):
            memory.delete_memory(item["id"])
        self.assertTrue(memory.delete_memory(item["id"], force=True))


if __name__ == "__main__":
    unittest.main()
