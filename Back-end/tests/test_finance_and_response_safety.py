import re
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from cognitive import finance, response_safety  # noqa: E402


FINANCE_CASE = """
Preciso de ajuda para me organizar quanto à fatura do meu cartão.
Seguinte: estou parcelando um MacBook, e pago R$ 690 por mês até setembro (estamos em julho).
Também pago R$ 105 por mês do ChatGPT.
Tenho R$ 33.000 de limite no cartão.
Recentemente precisei ajudar minha família e passei R$ 10.000 no cartão, divididos em 5 parcelas de R$ 2.000.
Só que tem um detalhe importante: esses R$ 2.000 não sou eu quem vai pagar. Todo mês minha família vai me fazer um Pix de R$ 2.000, e eu vou usar esse dinheiro exclusivamente para pagar essa parcela. Ou seja, esse valor não sai do meu salário.
Além disso, todo mês eu invisto R$ 2.000 para formar patrimônio no longo prazo, então gosto de considerar esse dinheiro como “intocável”.
Meu salário é de R$ 3.900 por mês.
Quero que você organize tudo isso para mim e me explique:
1. Quanto deve aparecer aproximadamente na minha fatura mensal enquanto essas parcelas existirem.
2. Quanto realmente pesa no meu orçamento, considerando o Pix que vou receber da minha família.
3. Quanto sobra do meu salário depois dos meus gastos fixos e do investimento de R$ 2.000.
4. Se essa organização financeira está saudável ou se existe algum risco.
5. Faça um resumo simples para eu usar como referência nos próximos meses.
Importante: não invente datas, parcelas ou valores que eu não informei. Se faltar alguma informação, diga claramente em vez de assumir algo.
"""


class FinanceReasoningTests(unittest.TestCase):
    def test_remaining_macbook_installments_are_inclusive(self):
        facts = finance.extract_financial_facts("R$ 690 até setembro, estamos em julho. Estou parcelando um MacBook em R$ 690 por mês até setembro.")
        macbook = next(item for item in facts["personal_fixed_expenses"] if item["name"] == "MacBook")
        self.assertEqual(macbook["remaining_installments"], 3)
        self.assertNotEqual(macbook["remaining_installments"], 4)

    def test_monthly_subscription_does_not_invent_six_months(self):
        facts = finance.extract_financial_facts("Pago R$ 105 de ChatGPT por mês.")
        chatgpt = next(item for item in facts["personal_fixed_expenses"] if item["name"] == "ChatGPT")
        context = finance.build_financial_context("Pago R$ 105 de ChatGPT por mês.")
        self.assertEqual(chatgpt["monthly_amount"], 105)
        self.assertNotIn("R$ 630", context)
        self.assertNotRegex(context.lower(), r"\b6 meses\b")

    def test_reimbursement_has_zero_personal_net_impact(self):
        facts = finance.extract_financial_facts(
            "Tenho parcela de R$ 2.000, mas receberei R$ 2.000 via Pix para pagar. "
            "Passei R$ 10.000 no cartão, divididos em 5 parcelas de R$ 2.000."
        )
        reimbursed = facts["reimbursed_expenses"][0]
        self.assertEqual(reimbursed["personal_net_impact"], 0)

    def test_complete_case_gross_invoice_and_personal_impact(self):
        facts = finance.extract_financial_facts(FINANCE_CASE)
        self.assertEqual(facts["monthly_income"], 3900)
        self.assertEqual(facts["monthly_invoice_gross_minimum"], 2795)
        self.assertEqual(facts["monthly_personal_net_impact"], 795)
        self.assertEqual(facts["monthly_investment_total"], 2000)
        self.assertEqual(facts["monthly_left_after_fixed_and_investment"], 1105)

    def test_full_financial_question_goes_to_ai_with_context(self):
        context = finance.build_financial_context(FINANCE_CASE)
        self.assertIsNone(finance.build_financial_reply(FINANCE_CASE))
        self.assertIn("R$ 2.795", context)
        self.assertIn("R$ 795", context)
        self.assertIn("R$ 1.105", context)

    def test_context_does_not_invent_future_months(self):
        context = finance.build_financial_context(FINANCE_CASE)
        forbidden = {"novembro", "dezembro", "janeiro", "fevereiro"}
        self.assertFalse(forbidden & set(re.findall(r"[a-záéíóúãõç]+", context.lower())))

    def test_financial_followups_use_previous_context(self):
        history = [{"sender": "user", "text": FINANCE_CASE}]
        net = finance.build_financial_reply("Então quanto realmente sai do meu salário?", history)
        invoice = finance.build_financial_reply("E quanto deve aparecer na fatura?", history)
        pix = finance.build_financial_reply("Posso usar o Pix da família para outra coisa?", history)
        leftover = finance.build_financial_reply("Quanto sobra depois do investimento?", history)
        self.assertIn("R$ 795", net)
        self.assertIn("R$ 2.795", invoice)
        self.assertIn("Não é recomendado", pix)
        self.assertIn("R$ 1.105", leftover)

    def test_non_financial_message_after_finance_does_not_repeat_budget(self):
        history = [{"sender": "user", "text": FINANCE_CASE}]
        self.assertIsNone(finance.build_financial_reply("oi, tudo bem?", history))
        self.assertIsNone(finance.build_financial_reply("me explica o que é React?", history))
        self.assertEqual(finance.build_financial_context("me explica o que é React?", history), "")

    def test_assistant_financial_reply_is_not_used_as_source_fact(self):
        history = [
            {"sender": "ia", "text": "Ajuda à família: entra R$ 2.000 na fatura e entra R$ 0 por Pix."},
            {"sender": "user", "text": FINANCE_CASE},
        ]
        reply = finance.build_financial_reply("Então quanto realmente sai do meu salário?", history)
        self.assertIn("R$ 795", reply)
        self.assertNotIn("R$ 2.000 por mês", reply)

    def test_bad_ai_financial_response_is_repaired(self):
        bad = """
        **Fatura Bruta Mensal:** Aproximadamente R$2.175 (MacBook) + R$105 (ChatGPT) = R$2.280
        Recebe de família por Pix: R$0/mês.
        Investimento intocável no patrimônio: R$4.000/mês.
        \\[(3 \\times 690) + 105 = 2.175\\]
        """
        repaired = finance.repair_financial_response(FINANCE_CASE, bad)
        self.assertIn("R$ 2.795", repaired)
        self.assertIn("R$ 795", repaired)
        self.assertIn("R$ 1.105", repaired)
        self.assertIn("R$ 2.000", repaired)
        self.assertNotIn("R$2.280", repaired)
        self.assertNotIn("R$4.000", repaired)


class ResponseSafetyTests(unittest.TestCase):
    def test_internal_json_and_tags_are_removed_for_non_code_question(self):
        raw = """
<thinking>calcular parcelas</thinking>
{"analysis": "interno", "plan": ["não mostrar"], "response": "A fatura bruta é R$ 2.795."}
```json
{"internal": true}
```
Resposta final: A fatura bruta é R$ 2.795 e o impacto pessoal é R$ 795.
"""
        clean = response_safety.sanitize_response(raw, user_text="me ajuda com minha fatura")
        lowered = clean.lower()
        self.assertIn("R$ 2.795", clean)
        self.assertIn("R$ 795", clean)
        self.assertNotIn("<thinking>", lowered)
        self.assertNotIn('"analysis"', lowered)
        self.assertNotIn("```", clean)
        self.assertNotIn("internal", lowered)

    def test_streaming_holds_unclosed_internal_tag(self):
        partial = response_safety.sanitize_response("<analysis>vou pensar\nA resposta", user_text="fatura", streaming=True)
        self.assertEqual(partial, "")

    def test_literal_think_tag_is_removed(self):
        raw = "<think>isto é raciocínio privado</think>Resposta visível."
        clean = response_safety.sanitize_response(raw, user_text="responda")
        self.assertEqual(clean, "Resposta visível.")

    def test_streaming_holds_fragmented_think_opening(self):
        for partial in ("<", "<t", "<thi", "<think"):
            with self.subTest(partial=partial):
                clean = response_safety.sanitize_response(
                    partial,
                    user_text="responda",
                    streaming=True,
                )
                self.assertEqual(clean, "")

        clean = response_safety.sanitize_response(
            "Antes <thi",
            user_text="responda",
            streaming=True,
        )
        self.assertEqual(clean, "Antes")

    def test_reasoning_alias_is_removed(self):
        raw = "<reasoning>não mostrar</reasoning>Conclusão."
        clean = response_safety.sanitize_response(raw, user_text="responda")
        self.assertEqual(clean, "Conclusão.")

    def test_final_marker_inside_think_does_not_bypass_filter(self):
        raw = "<think>Final answer: plano secreto</think>Resposta pública."
        clean = response_safety.sanitize_response(raw, user_text="responda")
        self.assertEqual(clean, "Resposta pública.")

    def test_unclosed_think_is_removed_in_final_response(self):
        clean = response_safety.sanitize_response(
            "<think>raciocínio interrompido",
            user_text="responda",
        )
        self.assertEqual(clean, "")

    def test_non_code_markdown_and_latex_are_cleaned(self):
        raw = """
### Resumo:
**Fatura Bruta Mensal:** \\[(3 \\times 690) + 105 = 2.175\\]
* Item com asterisco
"""
        clean = response_safety.sanitize_response(raw, user_text="me ajuda com a fatura")
        self.assertNotIn("**", clean)
        self.assertNotIn("###", clean)
        self.assertNotIn("\\[", clean)
        self.assertNotIn("\\times", clean)
        self.assertIn("Fatura Bruta Mensal:", clean)

    def test_explicit_java_request_preserves_fenced_code(self):
        question = "beleza, consegue me mandar um hello world em java?"
        raw = """Claro! Aqui está um exemplo simples:

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello, World!");
    }
}
```

Salve como Main.java e execute normalmente.
"""
        clean = response_safety.sanitize_response(raw, user_text=question)

        self.assertTrue(response_safety.allows_code(question))
        self.assertIn("```java", clean)
        self.assertIn('System.out.println("Hello, World!");', clean)
        self.assertIn("Salve como Main.java", clean)

    def test_streaming_preserves_incomplete_fence_for_code_request(self):
        partial = "```java\npublic class Main {"
        clean = response_safety.sanitize_response(
            partial,
            user_text="mande um hello world em Java",
            streaming=True,
        )
        self.assertEqual(clean, partial)


if __name__ == "__main__":
    unittest.main()
