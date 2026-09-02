"""Livro financeiro local do Buds Memory.

Valores são persistidos em centavos e os totais são calculados em código/SQL.
O LLM recebe apenas um resumo já calculado para explicar e sugerir próximos passos.
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from typing import Optional

from database_v2 import get_db_connection, now_iso


KINDS = {"income", "expense", "investment", "card"}
STATUSES = {"confirmed", "pending", "paid"}
MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
DATE_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$")


def current_month() -> str:
    return dt.date.today().strftime("%Y-%m")


def validate_month(value: Optional[str]) -> str:
    month = (value or current_month()).strip()
    if not MONTH_RE.fullmatch(month):
        raise ValueError("Mês inválido. Use o formato AAAA-MM.")
    return month


def _clean_payload(payload: dict, *, partial: bool = False) -> dict:
    clean: dict = {}
    if not partial or "kind" in payload:
        kind = str(payload.get("kind", "")).strip().lower()
        if kind not in KINDS:
            raise ValueError("Tipo financeiro inválido.")
        clean["kind"] = kind

    if not partial or "amount_cents" in payload:
        try:
            amount = int(payload.get("amount_cents", 0))
        except (TypeError, ValueError):
            raise ValueError("Informe um valor válido em centavos.") from None
        if amount <= 0 or amount > 999_999_999_99:
            raise ValueError("O valor deve ser maior que zero.")
        clean["amount_cents"] = amount

    if not partial or "description" in payload:
        description = str(payload.get("description", "")).strip()
        if not description:
            raise ValueError("Informe uma descrição.")
        clean["description"] = description[:120]

    if not partial or "category" in payload:
        clean["category"] = str(payload.get("category", "Outros")).strip()[:40] or "Outros"

    if not partial or "occurred_on" in payload:
        occurred_on = str(payload.get("occurred_on") or dt.date.today().isoformat()).strip()
        if not DATE_RE.fullmatch(occurred_on):
            raise ValueError("Data inválida. Use o formato AAAA-MM-DD.")
        try:
            dt.date.fromisoformat(occurred_on)
        except ValueError:
            raise ValueError("Data inválida.") from None
        clean["occurred_on"] = occurred_on

    kind = clean.get("kind", payload.get("kind"))
    if not partial or "invoice_month" in payload or kind == "card":
        invoice_month = payload.get("invoice_month") or str(clean.get("occurred_on") or payload.get("occurred_on") or "")[:7]
        clean["invoice_month"] = validate_month(str(invoice_month)) if kind == "card" else None

    if not partial or "status" in payload:
        default_status = "pending" if kind == "card" else "confirmed"
        status = str(payload.get("status") or default_status).strip().lower()
        if status not in STATUSES:
            raise ValueError("Status financeiro inválido.")
        if kind != "card":
            status = "confirmed"
        clean["status"] = status
    return clean


def create_transaction(payload: dict) -> dict:
    data = _clean_payload(payload)
    now = now_iso()
    with get_db_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO finance_transactions
              (kind,amount_cents,description,category,occurred_on,invoice_month,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?)
            """,
            (
                data["kind"], data["amount_cents"], data["description"], data["category"],
                data["occurred_on"], data["invoice_month"], data["status"], now, now,
            ),
        )
        conn.commit()
        return get_transaction(cursor.lastrowid, conn=conn)


def get_transaction(transaction_id: int, *, conn=None) -> Optional[dict]:
    owns = conn is None
    if owns:
        conn = get_db_connection()
    try:
        row = conn.execute("SELECT * FROM finance_transactions WHERE id=?", (transaction_id,)).fetchone()
        return dict(row) if row else None
    finally:
        if owns:
            conn.close()


def update_transaction(transaction_id: int, payload: dict) -> dict:
    with get_db_connection() as conn:
        current = get_transaction(transaction_id, conn=conn)
        if not current:
            raise LookupError("Lançamento não encontrado.")
        merged = {**current, **payload}
        data = _clean_payload(merged)
        conn.execute(
            """
            UPDATE finance_transactions
               SET kind=?,amount_cents=?,description=?,category=?,occurred_on=?,
                   invoice_month=?,status=?,updated_at=?
             WHERE id=?
            """,
            (
                data["kind"], data["amount_cents"], data["description"], data["category"],
                data["occurred_on"], data["invoice_month"], data["status"], now_iso(), transaction_id,
            ),
        )
        conn.commit()
        return get_transaction(transaction_id, conn=conn)


def delete_transaction(transaction_id: int) -> bool:
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM finance_transactions WHERE id=?", (transaction_id,))
        conn.commit()
        return cursor.rowcount > 0


def dashboard(month: Optional[str] = None) -> dict:
    selected = validate_month(month)
    with get_db_connection() as conn:
        rows = [dict(row) for row in conn.execute(
            """
            SELECT * FROM finance_transactions
             WHERE substr(occurred_on,1,7)=? OR (kind='card' AND invoice_month=?)
             ORDER BY occurred_on DESC,id DESC
            """,
            (selected, selected),
        ).fetchall()]

    totals = {
        "income_cents": 0,
        "expense_cents": 0,
        "investment_cents": 0,
        "invoice_cents": 0,
        "invoice_paid_cents": 0,
    }
    for item in rows:
        amount = int(item["amount_cents"])
        kind = item["kind"]
        if kind == "income" and item["occurred_on"][:7] == selected:
            totals["income_cents"] += amount
        elif kind == "expense" and item["occurred_on"][:7] == selected:
            totals["expense_cents"] += amount
        elif kind == "investment" and item["occurred_on"][:7] == selected:
            totals["investment_cents"] += amount
        elif kind == "card" and item["invoice_month"] == selected:
            key = "invoice_paid_cents" if item["status"] == "paid" else "invoice_cents"
            totals[key] += amount

    committed = (
        totals["expense_cents"] + totals["investment_cents"]
        + totals["invoice_cents"] + totals["invoice_paid_cents"]
    )
    totals["available_cents"] = totals["income_cents"] - committed
    totals["savings_rate"] = round(
        totals["investment_cents"] / totals["income_cents"] * 100, 1
    ) if totals["income_cents"] else 0.0
    return {"month": selected, "totals": totals, "transactions": rows}


def prompt_context(month: Optional[str] = None) -> str:
    data = dashboard(month)
    if not data["transactions"]:
        return ""
    totals = data["totals"]

    def brl(cents: int) -> str:
        value = cents / 100
        return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    return "\n".join([
        f"Resumo financeiro local calculado pelo código para {data['month']}:",
        f"Receitas confirmadas: {brl(totals['income_cents'])}.",
        f"Despesas fora do cartão: {brl(totals['expense_cents'])}.",
        f"Investimentos: {brl(totals['investment_cents'])}.",
        f"Fatura aberta: {brl(totals['invoice_cents'])}.",
        f"Fatura já paga: {brl(totals['invoice_paid_cents'])}.",
        f"Disponível após despesas, investimentos e fatura do mês: {brl(totals['available_cents'])}.",
        f"Taxa investida sobre a receita: {totals['savings_rate']:.1f}%.",
        "Estes totais são fatos calculados; não recalcule nem invente lançamentos.",
    ])


def direct_reply(text: str) -> Optional[str]:
    """Responde perguntas de total sem delegar aritmética ao modelo."""
    raw = text or ""
    normalized = unicodedata.normalize("NFD", raw.lower())
    normalized = "".join(char for char in normalized if unicodedata.category(char) != "Mn")
    month_match = re.search(r"\b(20\d{2}-(?:0[1-9]|1[0-2]))\b", raw)
    data = dashboard(month_match.group(1) if month_match else None)
    if not data["transactions"]:
        return None
    totals = data["totals"]

    def brl(cents: int) -> str:
        value = cents / 100
        return f"R$ {value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")

    month = data["month"]
    if re.search(r"quanto\s+(?:eu\s+)?invest|total\s+(?:de\s+)?invest", normalized):
        return f"Em {month}, você investiu {brl(totals['investment_cents'])}."
    if re.search(r"quanto\s+(?:eu\s+)?(?:ganhei|ganho|recebi)|total\s+(?:de\s+)?(?:renda|receita)", normalized):
        return f"Em {month}, suas receitas registradas somam {brl(totals['income_cents'])}."
    if "fatura" in normalized and re.search(r"quanto|qual|total|valor", normalized):
        paid = totals["invoice_paid_cents"]
        suffix = f" Você já marcou {brl(paid)} como pago." if paid else ""
        return f"Sua fatura aberta de {month} está em {brl(totals['invoice_cents'])}.{suffix}"
    if re.search(r"quanto\s+(?:me\s+)?sobra|quanto\s+(?:esta\s+)?livre|disponivel", normalized):
        return (
            f"Em {month}, o valor livre calculado é {brl(totals['available_cents'])}, "
            "depois das despesas, investimentos e fatura registrada."
        )
    return None
