import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import database_v2  # noqa: E402
from cognitive import finance_store  # noqa: E402


class FinanceStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "finance.sqlite3"
        self.patch = patch.object(database_v2, "DB_PATH", self.database_path)
        self.patch.start()
        with database_v2.get_db_connection() as conn:
            database_v2._create_finance_tables(conn)
            conn.commit()

    def tearDown(self):
        self.patch.stop()
        self.temp_dir.cleanup()

    def add(self, kind, cents, description, *, date="2026-09-10", month=None, status=None):
        return finance_store.create_transaction({
            "kind": kind,
            "amount_cents": cents,
            "description": description,
            "category": "Teste",
            "occurred_on": date,
            **({"invoice_month": month} if month else {}),
            **({"status": status} if status else {}),
        })

    def test_dashboard_calculates_month_in_cents(self):
        self.add("income", 500_000, "Salário")
        self.add("expense", 100_000, "Moradia")
        self.add("investment", 50_000, "Reserva")
        self.add("card", 75_000, "Fatura aberta", month="2026-09")
        self.add("card", 25_000, "Fatura paga", month="2026-09", status="paid")
        self.add("expense", 999_999, "Outro mês", date="2026-08-10")

        result = finance_store.dashboard("2026-09")

        self.assertEqual(result["totals"]["income_cents"], 500_000)
        self.assertEqual(result["totals"]["expense_cents"], 100_000)
        self.assertEqual(result["totals"]["investment_cents"], 50_000)
        self.assertEqual(result["totals"]["invoice_cents"], 75_000)
        self.assertEqual(result["totals"]["invoice_paid_cents"], 25_000)
        self.assertEqual(result["totals"]["available_cents"], 250_000)
        self.assertEqual(result["totals"]["savings_rate"], 10.0)
        self.assertEqual(len(result["transactions"]), 5)

    def test_card_defaults_to_transaction_month_and_can_be_paid(self):
        item = self.add("card", 12_345, "Mercado")
        self.assertEqual(item["invoice_month"], "2026-09")
        self.assertEqual(finance_store.dashboard("2026-09")["totals"]["invoice_cents"], 12_345)

        updated = finance_store.update_transaction(item["id"], {"status": "paid"})
        self.assertEqual(updated["status"], "paid")
        self.assertEqual(finance_store.dashboard("2026-09")["totals"]["invoice_paid_cents"], 12_345)

    def test_prompt_uses_precalculated_facts(self):
        self.add("income", 390_000, "Salário")
        self.add("investment", 200_000, "Patrimônio")
        context = finance_store.prompt_context("2026-09")
        self.assertIn("Receitas confirmadas: R$ 3.900,00", context)
        self.assertIn("Investimentos: R$ 2.000,00", context)
        self.assertIn("não recalcule", context)

    def test_simple_questions_are_answered_without_llm_math(self):
        self.add("income", 390_000, "Salário")
        self.add("investment", 200_000, "Patrimônio")
        self.add("card", 79_500, "Fatura", month="2026-09")

        self.assertIn("R$ 2.000,00", finance_store.direct_reply("Quanto investi em 2026-09?"))
        self.assertIn("R$ 3.900,00", finance_store.direct_reply("Quanto ganhei em 2026-09?"))
        self.assertIn("R$ 795,00", finance_store.direct_reply("Qual o valor da fatura de 2026-09?"))
        self.assertIsNone(finance_store.direct_reply("Analise meu mês de 2026-09"))

    def test_invalid_data_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Tipo financeiro"):
            self.add("loan", 100, "Inválido")
        with self.assertRaisesRegex(ValueError, "Mês inválido"):
            finance_store.dashboard("09/2026")
        with self.assertRaisesRegex(ValueError, "maior que zero"):
            self.add("expense", 0, "Zero")


if __name__ == "__main__":
    unittest.main()
