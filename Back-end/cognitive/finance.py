"""
cognitive/finance.py — leitura financeira local para orçamento, fatura e reembolso.

O módulo extrai fatos simples de mensagens em português e monta uma resposta
determinística quando há dados suficientes. Ele não tenta substituir consultoria
financeira; serve para impedir alucinações de parcelas, datas e valores básicos.
"""

from __future__ import annotations

import datetime
import re
from typing import Optional


MONTHS_PT = {
    "janeiro": 1,
    "fevereiro": 2,
    "março": 3,
    "marco": 3,
    "abril": 4,
    "maio": 5,
    "junho": 6,
    "julho": 7,
    "agosto": 8,
    "setembro": 9,
    "outubro": 10,
    "novembro": 11,
    "dezembro": 12,
}

MONTH_NAMES = {value: key for key, value in MONTHS_PT.items() if key != "marco"}

FINANCIAL_KEYWORDS = {
    "orçamento", "orcamento", "fatura", "cartão", "cartao", "limite", "parcela",
    "parcelas", "parcelando", "salário", "salario", "pix", "reembolso",
    "reembolsado", "receberei", "receber", "pagar", "gasto", "despesa",
    "dívida", "divida", "fluxo de caixa", "renda", "assinatura", "pago",
    "pagando", "por mês", "por mes", "mensalidade", "mensal", "invisto",
    "investir", "investimento", "patrimônio", "patrimonio", "finanças",
    "financas", "financeiro", "financeira",
}


def detect_financial_intents(text: str) -> list[str]:
    """Retorna subintenções financeiras detectadas por regras baratas."""
    lower = _normalize(text)
    labels: list[str] = []

    def add(label: str, condition: bool) -> None:
        if condition and label not in labels:
            labels.append(label)

    has_money = bool(_money_values(lower))
    add("FINANCIAL_BUDGET", any(term in lower for term in (
        "minhas finanças", "minhas financas", "resumo financeiro", "assistente financeiro",
        "quanto investi", "quanto ganhei", "quanto tenho de fatura", "como está meu mês",
        "como esta meu mes",
    )))
    add("FINANCIAL_BUDGET", has_money and any(term in lower for term in ("organizar", "orçamento", "orcamento", "salário", "salario", "gasto", "despesa", "pago", "pagando", "mensal", "por mês", "por mes")))
    add("CREDIT_CARD", any(term in lower for term in ("cartão", "cartao", "fatura", "limite")))
    add("INSTALLMENT_PLAN", any(term in lower for term in ("parcela", "parcelas", "parcelando", "dividido", "divididos", "vezes")))
    add("REIMBURSEMENT", any(term in lower for term in ("pix", "reembolso", "reembols", "receberei", "me enviará", "me enviara", "vão me mandar", "vao me mandar")))
    add("CASH_FLOW", has_money and any(term in lower for term in ("sai do meu salário", "sai do meu salario", "impacto", "fluxo", "quanto sobra", "renda")))
    add("SAVINGS", any(term in lower for term in ("guardar", "economizar", "reserva", "poupar", "invisto", "investir", "investimento", "patrimônio", "patrimonio")))
    add("DEBT", any(term in lower for term in ("dívida", "divida", "devendo", "juros", "atraso")))
    add("EXPENSE_ORGANIZATION", has_money and any(term in lower for term in ("organizar", "separar", "planejar", "fatura", "gastos")))

    if has_money and any(term in lower for term in FINANCIAL_KEYWORDS) and "FINANCIAL_BUDGET" not in labels:
        labels.insert(0, "FINANCIAL_BUDGET")
    return labels


def is_financial_query(text: str) -> bool:
    return bool(detect_financial_intents(text))


def is_financial_followup(text: str) -> bool:
    """Detecta continuação curta de um assunto financeiro já aberto."""
    lower = _normalize(text)
    words = re.findall(r"\w+", lower)
    if len(words) > 18:
        return False
    return bool(re.search(
        r"\b(fatura|cart[aã]o|limite|parcela|parcelas|pix|reembolso|sal[aá]rio|"
        r"gasto|despesa|dinheiro|quanto sai|quanto aparece|quanto sobra|impacto|usar.*pix|"
        r"outra coisa|isso)\b",
        lower,
        re.I,
    ))


def should_use_financial_context(text: str, history: Optional[list[dict]] = None) -> bool:
    """Evita que uma conversa financeira antiga contamine qualquer nova mensagem."""
    if is_financial_query(text):
        return True
    if not is_financial_followup(text):
        return False
    return any(
        item.get("sender") == "user" and is_financial_query(str(item.get("text", "")))
        for item in (history or [])[-8:]
    )


def should_answer_financial_directly(text: str, history: Optional[list[dict]] = None) -> bool:
    """Só permite resposta determinística em follow-ups curtos sem novos dados."""
    if _money_values(text):
        return False
    if not should_use_financial_context(text, history):
        return False
    return is_financial_followup(text)


def extract_financial_facts(text: str, current_date: Optional[datetime.date] = None) -> dict:
    """Extrai valores financeiros sem inventar dados ausentes."""
    raw = text or ""
    lower = _normalize(raw)
    current_date = current_date or datetime.date.today()
    current_month = _current_month_from_text(lower) or current_date.month

    facts = {
        "source_text": raw,
        "monthly_income": _extract_monthly_income(lower),
        "credit_limit": _extract_credit_limit(lower),
        "current_month": current_month,
        "personal_fixed_expenses": [],
        "reimbursed_expenses": [],
        "monthly_investments": [],
        "assumptions": [],
        "financial_intents": detect_financial_intents(raw),
    }

    facts["personal_fixed_expenses"].extend(_extract_installment_expenses(raw, lower, current_month))
    facts["personal_fixed_expenses"].extend(_extract_recurring_expenses(raw, lower, facts["personal_fixed_expenses"]))
    facts["reimbursed_expenses"].extend(_extract_reimbursed_expenses(raw, lower))
    facts["monthly_investments"].extend(_extract_monthly_investments(raw))

    personal_total = sum(item.get("monthly_amount") or 0 for item in facts["personal_fixed_expenses"])
    reimbursed_monthly = sum(item.get("monthly_amount") or 0 for item in facts["reimbursed_expenses"])
    reimbursement_total = sum(item.get("monthly_reimbursement") or 0 for item in facts["reimbursed_expenses"])
    net_reimbursed_impact = sum(max((item.get("monthly_amount") or 0) - (item.get("monthly_reimbursement") or 0), 0) for item in facts["reimbursed_expenses"])
    investment_total = sum(item.get("monthly_amount") or 0 for item in facts["monthly_investments"])

    if facts["reimbursed_expenses"]:
        facts["assumptions"].append("Considerando que a parcela reembolsada entre na próxima fatura, pois a data exata da primeira parcela não foi informada.")

    facts["monthly_personal_fixed_total"] = personal_total
    facts["monthly_reimbursed_card_total"] = reimbursed_monthly
    facts["monthly_reimbursement_total"] = reimbursement_total
    facts["monthly_investment_total"] = investment_total
    facts["monthly_invoice_gross_minimum"] = personal_total + reimbursed_monthly
    facts["monthly_personal_net_impact"] = personal_total + net_reimbursed_impact
    facts["monthly_left_after_fixed_and_investment"] = (
        facts["monthly_income"] - facts["monthly_personal_net_impact"] - investment_total
        if facts.get("monthly_income") is not None
        else None
    )
    return facts


def build_financial_context(text: str, history: Optional[list[dict]] = None) -> str:
    """Monta um bloco interno de orientação para o modelo, sem JSON."""
    if not should_use_financial_context(text, history):
        return ""
    combined = _combine_financial_history(text, history)
    facts = extract_financial_facts(combined)
    if not facts["financial_intents"]:
        return ""

    structured_context = ""
    try:
        from cognitive import finance_store
        month_match = re.search(r"\b(20\d{2}-(?:0[1-9]|1[0-2]))\b", text or "")
        structured_context = finance_store.prompt_context(month_match.group(1) if month_match else None)
    except Exception:
        # O chat continua funcionando durante migração ou recuperação do banco.
        structured_context = ""

    lines = [
        "Análise financeira estruturada local:",
        "Regras: não inventar meses, vencimentos, juros, parcelas ou valores não informados.",
        "Separar sempre fatura bruta, despesa pessoal, reembolso e impacto líquido no salário.",
    ]
    if structured_context:
        lines.extend([structured_context, "Use estes dados persistentes como fonte principal."])
    if facts.get("monthly_income"):
        lines.append(f"Salário mensal informado: {_format_brl(facts['monthly_income'])}.")
    if facts.get("credit_limit"):
        lines.append(f"Limite do cartão informado: {_format_brl(facts['credit_limit'])}. Use apenas se o usuário perguntar sobre limite.")
    if facts["personal_fixed_expenses"]:
        lines.append(f"Total mensal de despesas pessoais fixas identificadas: {_format_brl(facts['monthly_personal_fixed_total'])}.")
        for item in facts["personal_fixed_expenses"][:8]:
            suffix = ""
            if item.get("end_month"):
                suffix = f" até {item['end_month']}"
            if item.get("remaining_installments"):
                suffix += f" ({item['remaining_installments']} parcelas restantes, contando o mês atual)"
            lines.append(f"- {item['name']}: {_format_brl(item['monthly_amount'])}/mês{suffix}.")
    if facts["reimbursed_expenses"]:
        lines.append(f"Total mensal que aparece na fatura mas é reembolsado: {_format_brl(facts['monthly_reimbursed_card_total'])}.")
        for item in facts["reimbursed_expenses"][:6]:
            lines.append(
                f"- {item['name']}: parcela {_format_brl(item['monthly_amount'])}; "
                f"reembolso mensal {_format_brl(item['monthly_reimbursement'])}; "
                f"impacto líquido pessoal {_format_brl(item['personal_net_impact'])}."
            )
    if facts["monthly_investments"]:
        lines.append(f"Investimento mensal informado como intocável: {_format_brl(facts['monthly_investment_total'])}.")
        for item in facts["monthly_investments"][:4]:
            lines.append(f"- {item['name']}: {_format_brl(item['monthly_amount'])}/mês.")
    if facts["monthly_invoice_gross_minimum"]:
        lines.append(f"Fatura bruta mínima estimada com os dados fornecidos: {_format_brl(facts['monthly_invoice_gross_minimum'])}, antes de outras compras pessoais.")
    if facts["monthly_personal_net_impact"]:
        lines.append(f"Impacto pessoal mensal no salário: {_format_brl(facts['monthly_personal_net_impact'])}, antes de outras compras pessoais.")
    if facts.get("monthly_left_after_fixed_and_investment") is not None:
        lines.append(
            "Sobra estimada depois de gastos pessoais fixos e investimento informado: "
            f"{_format_brl(facts['monthly_left_after_fixed_and_investment'])}, antes de outros gastos variáveis."
        )
    for assumption in facts["assumptions"][:3]:
        lines.append("Suposição explícita: " + assumption)
    lines.append("Orientação: dinheiro recebido para pagar despesa de terceiro é dinheiro de passagem; reservar integralmente para a fatura.")
    return "\n".join(lines)


def build_financial_reply(text: str, history: Optional[list[dict]] = None) -> Optional[str]:
    """Gera resposta determinística para organização financeira quando os fatos fecham."""
    try:
        from cognitive import finance_store
        stored_reply = finance_store.direct_reply(text)
        if stored_reply:
            return stored_reply
    except Exception:
        pass
    if not should_answer_financial_directly(text, history):
        return None
    combined = _combine_financial_history(text, history)
    facts = extract_financial_facts(combined)
    if not facts["financial_intents"]:
        return None

    lower_current = _normalize(text)
    is_short_followup = len(re.findall(r"\w+", lower_current)) <= 18
    has_useful_numbers = facts["personal_fixed_expenses"] or facts["reimbursed_expenses"] or facts.get("monthly_income")
    if not has_useful_numbers:
        return None

    if is_short_followup and re.search(r"quanto.*(?:sai|sair).*sal[aá]rio|impacto.*sal[aá]rio|realmente sai", lower_current):
        return (
            f"Do seu salário, o impacto real é {_format_brl(facts['monthly_personal_net_impact'])} por mês, "
            "além de outras compras pessoais. Isso considera que o reembolso recebido será guardado integralmente para pagar a parcela correspondente."
        )

    if is_short_followup and re.search(r"quanto.*(?:fatura|aparece|aparecer)|valor.*fatura", lower_current):
        return (
            f"Na fatura deve aparecer pelo menos {_format_brl(facts['monthly_invoice_gross_minimum'])} por mês, "
            "além de outras compras pessoais. Esse valor mistura gasto seu com valor reembolsado, então não trate tudo como saída real do salário."
        )

    if is_short_followup and re.search(r"quanto sobra|sobra.*sal[aá]rio|depois.*invest", lower_current):
        leftover = facts.get("monthly_left_after_fixed_and_investment")
        if leftover is not None:
            return (
                f"Sobra aproximadamente {_format_brl(leftover)} do seu salário depois dos gastos fixos pessoais "
                "e do investimento informado, antes de outros gastos variáveis."
            )

    if is_short_followup and re.search(r"usar.*pix|pix.*outra coisa|usar.*reembolso|reembolso.*outra coisa", lower_current):
        return (
            "Não é recomendado. Esse Pix deve ficar separado como dinheiro de passagem para quitar a parcela correspondente; "
            "se você usar para outra coisa, a dívida passa a sair do seu salário."
        )

    return None


def repair_financial_response(text: str, reply: str, history: Optional[list[dict]] = None) -> str:
    """Corrige respostas financeiras que contradizem os fatos locais extraídos."""
    if not should_use_financial_context(text, history) or not reply:
        return reply

    combined = _combine_financial_history(text, history)
    facts = extract_financial_facts(combined)
    if not facts["financial_intents"]:
        return reply

    issues = _financial_response_issues(reply, facts)
    if not issues:
        return reply
    return build_financial_safe_reply(facts)


def build_financial_safe_reply(facts: dict) -> str:
    """Resposta financeira segura baseada nos fatos extraídos, sem Markdown técnico."""
    lines = ["Organização financeira mensal"]

    if facts.get("monthly_income"):
        lines.append(f"\nReceita: {_format_brl(facts['monthly_income'])} por mês.")

    lines.append("\n1. Fatura aproximada enquanto essas parcelas existirem")
    if facts["personal_fixed_expenses"]:
        for item in facts["personal_fixed_expenses"]:
            extra = ""
            if item.get("end_month"):
                extra = f" até {item['end_month']}"
            if item.get("remaining_installments"):
                extra += f", {item['remaining_installments']} parcelas restantes"
            lines.append(f"- {item['name']}: {_format_brl(item['monthly_amount'])} por mês{extra}.")
    if facts["reimbursed_expenses"]:
        for item in facts["reimbursed_expenses"]:
            lines.append(f"- {item['name']}: {_format_brl(item['monthly_amount'])} por mês aparece na fatura, mas é reembolsado.")
    lines.append(f"Total bruto mínimo da fatura: {_format_brl(facts['monthly_invoice_gross_minimum'])}, antes de outras compras pessoais.")

    lines.append("\n2. Peso real no seu orçamento")
    if facts["reimbursed_expenses"]:
        lines.append(f"- Valor reembolsado por mês: {_format_brl(facts['monthly_reimbursement_total'])}.")
        lines.append("- Esse dinheiro é de passagem: entra via Pix e deve ir direto para pagar a parcela correspondente.")
    lines.append(f"Impacto real no salário: {_format_brl(facts['monthly_personal_net_impact'])}, antes de outras compras pessoais.")

    if facts.get("monthly_investment_total"):
        lines.append("\n3. Sobra depois dos gastos fixos e investimento")
        lines.append(f"- Investimento intocável: {_format_brl(facts['monthly_investment_total'])} por mês.")
        if facts.get("monthly_left_after_fixed_and_investment") is not None:
            lines.append(
                f"Sobra estimada: {_format_brl(facts['monthly_left_after_fixed_and_investment'])}, "
                "antes de gastos variáveis como alimentação, transporte, lazer e compras extras."
            )

    lines.append("\n4. Saúde financeira e riscos")
    leftover = facts.get("monthly_left_after_fixed_and_investment")
    if leftover is not None and leftover < 0:
        lines.append("- Atenção: seus fixos mais investimento passam do salário. Seria preciso reduzir algo ou usar outra renda.")
    elif leftover is not None and leftover < 500:
        lines.append("- Está apertado: a margem para gastos variáveis é pequena.")
    else:
        lines.append("- A estrutura é saudável se o Pix da família for reservado integralmente e você não usar esse valor como renda livre.")
    lines.append("- O principal risco é misturar o Pix da família com dinheiro pessoal e depois precisar pagar essa parcela com o salário.")

    lines.append("\n5. Referência rápida")
    lines.append(f"- Fatura bruta mínima: {_format_brl(facts['monthly_invoice_gross_minimum'])}.")
    lines.append(f"- Peso real no salário: {_format_brl(facts['monthly_personal_net_impact'])}.")
    if facts.get("monthly_left_after_fixed_and_investment") is not None:
        lines.append(f"- Sobra estimada após investimento: {_format_brl(facts['monthly_left_after_fixed_and_investment'])}.")
    if facts["assumptions"]:
        lines.append("- Observação: " + facts["assumptions"][0])
    return "\n".join(lines)


def validate_financial_reply(reply: str, facts: dict) -> list[str]:
    """Validações simples para testes e reflection financeira."""
    issues = []
    lower = _normalize(reply)
    if facts.get("monthly_reimbursed_card_total") and "impacto líquido" not in lower and "impacto liquido" not in lower:
        issues.append("Resposta não destaca impacto líquido de reembolso.")
    forbidden_months = {"novembro", "dezembro", "janeiro", "fevereiro"}
    supplied_months = {name for name in MONTHS_PT if name in _normalize(facts.get("source_text", ""))}
    invented = sorted(month for month in forbidden_months if month in lower and month not in supplied_months)
    if invented:
        issues.append("Resposta contém meses não informados: " + ", ".join(invented))
    return issues


def _financial_response_issues(reply: str, facts: dict) -> list[str]:
    issues = validate_financial_reply(reply, facts)

    if facts.get("monthly_invoice_gross_minimum") and not _contains_money(reply, facts["monthly_invoice_gross_minimum"]):
        issues.append("Resposta não contém fatura bruta correta.")
    if facts.get("monthly_personal_net_impact") is not None and not _contains_money(reply, facts["monthly_personal_net_impact"]):
        issues.append("Resposta não contém impacto pessoal correto.")
    if facts.get("monthly_investment_total") and facts.get("monthly_left_after_fixed_and_investment") is not None:
        if not _contains_money(reply, facts["monthly_left_after_fixed_and_investment"]):
            issues.append("Resposta não contém sobra correta após investimento.")
    if facts.get("monthly_reimbursement_total") and re.search(r"(pix|reembolso).{0,30}R\$\s*0\b", reply, re.I):
        issues.append("Resposta zerou um reembolso informado.")
    if facts.get("monthly_investment_total") and not _amount_known(facts, 4000) and re.search(r"R\$\s*4\.?000\b", reply):
        issues.append("Resposta inventou ou duplicou investimento de R$ 4.000.")
    if re.search(r"3\s*[x×*]\s*690|3\s+parcelas.{0,40}fatura mensal", reply, re.I):
        issues.append("Resposta tratou total de parcelas como valor mensal.")
    return issues


def _contains_money(text: str, value: float) -> bool:
    target = _format_brl(value).replace(" ", "").lower()
    normalized = re.sub(r"\s+", "", text or "").lower()
    return target in normalized


def _amount_known(facts: dict, amount: float) -> bool:
    values = [
        facts.get("monthly_income"),
        facts.get("credit_limit"),
        facts.get("monthly_personal_fixed_total"),
        facts.get("monthly_reimbursed_card_total"),
        facts.get("monthly_reimbursement_total"),
        facts.get("monthly_investment_total"),
        facts.get("monthly_invoice_gross_minimum"),
        facts.get("monthly_personal_net_impact"),
        facts.get("monthly_left_after_fixed_and_investment"),
    ]
    for group in ("personal_fixed_expenses", "reimbursed_expenses", "monthly_investments"):
        for item in facts.get(group, []):
            values.extend([
                item.get("monthly_amount"),
                item.get("monthly_reimbursement"),
                item.get("personal_net_impact"),
                item.get("total_amount"),
            ])
    return any(value is not None and abs(float(value) - amount) < 0.01 for value in values)


def _combine_financial_history(text: str, history: Optional[list[dict]]) -> str:
    if is_financial_query(text) and _money_values(text):
        return text or ""

    relevant = []
    for item in (history or [])[-8:]:
        if item.get("sender") != "user":
            continue
        item_text = str(item.get("text", "")).strip()
        if item_text and is_financial_query(item_text):
            relevant.append(item_text)
    relevant.append(text or "")
    return "\n".join(relevant)


def _extract_installment_expenses(raw: str, lower: str, current_month: int) -> list[dict]:
    items: list[dict] = []
    patterns = [
        re.compile(
            r"(?:parcelando|parcelado|parcela(?:ndo)?|comprei|financiei)\s+(?:um|uma|o|a)?\s*"
            r"(?P<name>[A-Za-zÀ-ÿ0-9 _.-]{2,60}?)\s+(?:em|por|de)\s+R\$\s*(?P<amount>[\d.,]+)"
            r"(?P<tail>[^.\n;]{0,120})",
            re.I,
        ),
        re.compile(
            r"(?:parcelando|parcelado|parcela(?:ndo)?|comprei|financiei)\s+(?:um|uma|o|a)?\s*"
            r"(?P<name>[A-Za-zÀ-ÿ0-9 _.-]{2,60}?),?\s*(?:e\s+)?pago\s+R\$\s*(?P<amount>[\d.,]+)"
            r"(?P<tail>[^.\n;]{0,140})",
            re.I,
        ),
    ]
    for pattern in patterns:
        for match in pattern.finditer(raw):
            name = _clean_name(match.group("name"))
            amount = _parse_money(match.group("amount"))
            tail = _normalize(match.group("tail"))
            if not amount or _looks_reimbursed_context(_normalize(match.group(0))):
                continue
            month_name = _find_month_after_until(tail)
            remaining = _remaining_installments(current_month, MONTHS_PT.get(month_name)) if month_name else None
            items.append({
                "name": name,
                "monthly_amount": amount,
                "end_month": month_name,
                "remaining_installments": remaining,
                "source": "installment",
            })
    return _dedupe_expenses(items)


def _extract_recurring_expenses(raw: str, lower: str, existing: list[dict]) -> list[dict]:
    items: list[dict] = []
    patterns = [
        re.compile(
            r"(?:pago|pagando|assino|assinatura(?: de)?)\s+R\$\s*(?P<amount>[\d.,]+)"
            r"(?:\s+(?:de|do|da|no|na))?\s+(?P<name>[A-Za-zÀ-ÿ0-9 _-]{2,50}?)"
            r"\s+(?P<monthly>por m[eê]s|por mes|mensal)",
            re.I,
        ),
        re.compile(
            r"(?:pago|pagando|assino|assinatura(?: de)?)\s+R\$\s*(?P<amount>[\d.,]+)"
            r"\s+(?:por m[eê]s|por mes|mensal)\s+(?:do|da|de)?\s*(?P<name>[A-Za-zÀ-ÿ0-9 _-]{2,50})",
            re.I,
        ),
    ]
    for pattern in patterns:
        for match in pattern.finditer(raw):
            amount = _parse_money(match.group("amount"))
            name = _clean_name(match.group("name"))
            if not amount:
                continue
            if name == "Despesa" and any(abs((item.get("monthly_amount") or 0) - amount) < 0.01 for item in existing):
                continue
            if any(item.get("source") == "installment" and abs((item.get("monthly_amount") or 0) - amount) < 0.01 for item in existing):
                continue
            if any(abs((item.get("monthly_amount") or 0) - amount) < 0.01 and item.get("name", "").lower() == name.lower() for item in existing):
                continue
            items.append({
                "name": name,
                "monthly_amount": amount,
                "recurring": True,
                "source": "recurring",
            })
    return _dedupe_expenses(items)


def _extract_reimbursed_expenses(raw: str, lower: str) -> list[dict]:
    total_match = re.search(
        r"passei\s+R\$\s*(?P<total>[\d.,]+).*?(?:dividid[oa]s?\s+em|em)\s+"
        r"(?P<count>\d{1,3})\s+parcelas?\s+de\s+R\$\s*(?P<monthly>[\d.,]+)",
        raw,
        re.I | re.S,
    )
    reimbursement_match = re.search(
        r"(?:(?:receberei|recebo|me enviará|me enviara|v[aã]o me mandar|vai me mandar|enviar[aá]).{0,100}?"
        r"R\$\s*(?P<reimbursement>[\d.,]+).{0,100}?(?:pix|pagar|quitar|parcela)"
        r"|(?:pix|fazer um pix|me fazer um pix)\s+(?:de\s+)?R\$\s*(?P<reimbursement_pix>[\d.,]+))",
        raw,
        re.I | re.S,
    )
    if not total_match and not reimbursement_match:
        return []

    monthly = _parse_money(total_match.group("monthly")) if total_match else _parse_money(reimbursement_match.group("reimbursement"))
    reimbursement = (
        _parse_money(reimbursement_match.group("reimbursement") or reimbursement_match.group("reimbursement_pix"))
        if reimbursement_match
        else 0
    )
    total = _parse_money(total_match.group("total")) if total_match else None
    count = int(total_match.group("count")) if total_match else None
    if not monthly:
        return []

    name = "Compra de terceiro"
    if re.search(r"fam[ií]lia|familiar|pai|m[aã]e|irm[aã]o", lower):
        name = "Ajuda à família"
    elif re.search(r"empresa|trabalho|cliente", lower):
        name = "Despesa reembolsada"

    return [{
        "name": name,
        "total_amount": total,
        "installments": count,
        "monthly_amount": monthly,
        "monthly_reimbursement": reimbursement,
        "personal_net_impact": max(monthly - reimbursement, 0),
        "source": "reimbursement",
    }]


def _extract_monthly_investments(raw: str) -> list[dict]:
    items = []
    patterns = [
        re.compile(r"(?:todo m[eê]s\s+)?(?:eu\s+)?invisto\s+R\$\s*(?P<amount>[\d.,]+)(?P<tail>[^.\n;]{0,100})", re.I),
        re.compile(r"investimento(?: mensal)?\s+(?:de\s+)?R\$\s*(?P<amount>[\d.,]+)(?P<tail>[^.\n;]{0,100})", re.I),
    ]
    for pattern in patterns:
        for match in pattern.finditer(raw):
            amount = _parse_money(match.group("amount"))
            if not amount:
                continue
            name = "Investimento de longo prazo"
            tail = _normalize(match.group("tail"))
            if "patrim" in tail:
                name = "Patrimônio de longo prazo"
            items.append({
                "name": name,
                "monthly_amount": amount,
                "source": "investment",
            })
    return _dedupe_investments(items)


def _money_values(text: str) -> list[float]:
    return [_parse_money(match.group(1)) for match in re.finditer(r"R\$\s*([\d.,]+)", text, re.I) if _parse_money(match.group(1)) is not None]


def _extract_monthly_income(text: str) -> Optional[float]:
    patterns = [
        r"\bmeu\s+sal[aá]rio\s*(?:é|e|:|é de|e de|de)?\s*R\$\s*([\d.,]+)",
        r"\bsal[aá]rio\s*(?:mensal\s*)?(?:é|e|:|de)?\s*R\$\s*([\d.,]+)",
        r"\b(?:ganho|recebo)\s+R\$\s*([\d.,]+)\s+(?:por m[eê]s|mensais|de sal[aá]rio)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return _parse_money(match.group(1))
    return None


def _extract_credit_limit(text: str) -> Optional[float]:
    patterns = [
        r"\btenho\s+R\$\s*([\d.,]+)\s+de\s+limite",
        r"\blimite(?:\s+do|\s+no)?\s+cart[aã]o\s*(?:é|e|:|de)?\s*R\$\s*([\d.,]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.I)
        if match:
            return _parse_money(match.group(1))
    return None


def _parse_money(value: str) -> Optional[float]:
    if not value:
        return None
    clean = value.strip().strip(".,;:").replace(" ", "")
    if "," in clean:
        clean = clean.replace(".", "").replace(",", ".")
    elif clean.count(".") >= 1:
        parts = clean.split(".")
        if all(len(part) == 3 for part in parts[1:]):
            clean = "".join(parts)
    try:
        return float(clean)
    except ValueError:
        return None


def _format_brl(value: Optional[float]) -> str:
    value = float(value or 0)
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    if formatted.endswith(",00"):
        formatted = formatted[:-3]
    return f"R$ {formatted}"


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _current_month_from_text(lower: str) -> Optional[int]:
    match = re.search(r"estamos em ([a-zçãé]+)", lower)
    if match:
        return MONTHS_PT.get(match.group(1))
    return None


def _find_month_after_until(text: str) -> Optional[str]:
    match = re.search(r"at[eé]\s+([a-zçãé]+)", text, re.I)
    if not match:
        return None
    month = match.group(1).lower()
    return month if month in MONTHS_PT else None


def _remaining_installments(current_month: Optional[int], end_month: Optional[int]) -> Optional[int]:
    if not current_month or not end_month:
        return None
    if end_month >= current_month:
        return end_month - current_month + 1
    return (12 - current_month) + end_month + 1


def _clean_name(name: str) -> str:
    cleaned = re.sub(r"\s+", " ", (name or "").strip(" .,:;-"))
    cleaned = re.sub(r"\b(?:por mês|por mes|mensal|até|ate)\b.*$", "", cleaned, flags=re.I).strip()
    return cleaned[:1].upper() + cleaned[1:] if cleaned else "Despesa"


def _looks_reimbursed_context(text: str) -> bool:
    return any(term in text for term in ("família", "familia", "reembolso", "receberei", "pix", "terceiro"))


def _dedupe_expenses(items: list[dict]) -> list[dict]:
    seen = set()
    deduped = []
    for item in items:
        key = (item.get("name", "").lower(), item.get("monthly_amount"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _dedupe_investments(items: list[dict]) -> list[dict]:
    """Deduplica a mesma meta de investimento repetida no texto ou nas perguntas."""
    by_amount: dict[float, dict] = {}
    for item in items:
        amount = item.get("monthly_amount")
        if amount is None:
            continue
        amount = float(amount)
        current = by_amount.get(amount)
        if current is None:
            by_amount[amount] = item
            continue
        current_name = (current.get("name") or "").lower()
        item_name = (item.get("name") or "").lower()
        if "patrim" in item_name and "patrim" not in current_name:
            by_amount[amount] = item
    return list(by_amount.values())
