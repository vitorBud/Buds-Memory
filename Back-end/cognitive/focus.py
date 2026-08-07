import json
from typing import List, Dict, Any, Optional
from datetime import datetime
from database_v2 import get_db_connection
import agenty

import re
import string

# -----------------------------------------------------------------------------
# DEDUPLICAÇÃO
# -----------------------------------------------------------------------------
def _normalize_for_dedup(text: str) -> str:
    if not text:
        return ""
    text = text.lower()
    # Remover pontuação
    for p in string.punctuation:
        text = text.replace(p, " ")
    # Remover prefixos e stopwords comuns do contexto
    prefixes = [
        "ideia de ", "tive uma ideia de ", "tive uma ideia ", "ideia pra ",
        "decidi que ", "decidi ", "preciso ", "tenho que ", "vou fazer ", "vou ",
        "quero "
    ]
    for pref in prefixes:
        if text.startswith(pref):
            text = text[len(pref):]
    
    # Normalizar espaços
    text = re.sub(r"\s+", " ", text).strip()
    return text

def _is_duplicate(new_text: str, existing_texts: List[str]) -> bool:
    norm_new = _normalize_for_dedup(new_text)
    if not norm_new:
        return False
        
    for text in existing_texts:
        norm_exist = _normalize_for_dedup(text)
        if not norm_exist:
            continue
        # Simple string match or high overlap
        if norm_new == norm_exist:
            return True
        # Token overlap heuristic (optional, keep it simple for now)
        tokens1 = set(norm_new.split())
        tokens2 = set(norm_exist.split())
        if not tokens1 or not tokens2:
            continue
        intersection = tokens1.intersection(tokens2)
        # Se 80% das palavras forem iguais
        if len(intersection) / max(len(tokens1), len(tokens2)) > 0.8:
            return True
            
    return False

# -----------------------------------------------------------------------------
# TASKS
# -----------------------------------------------------------------------------
def get_focus_tasks() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM focus_tasks ORDER BY completed ASC, priority DESC, created_at DESC").fetchall()
        return [dict(r) for r in rows]

def create_focus_task(title: str, category: str = 'other', priority: str = 'medium', is_focus: bool = False, due_date: Optional[str] = None) -> Optional[Dict[str, Any]]:
    # Dedup
    tasks = get_focus_tasks()
    open_tasks = [t['title'] for t in tasks if not t.get('completed')]
    if _is_duplicate(title, open_tasks):
        # Encontra a tarefa existente
        for t in tasks:
            if not t.get('completed') and _is_duplicate(title, [t['title']]):
                return t

    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        if is_focus:
            conn.execute("UPDATE focus_tasks SET is_focus = 0")
        
        cursor = conn.execute(
            """INSERT INTO focus_tasks (title, category, priority, completed, is_focus, created_at, updated_at, due_date)
               VALUES (?, ?, ?, 0, ?, ?, ?, ?)""",
            (title.strip(), category, priority, 1 if is_focus else 0, now, now, due_date)
        )
        task_id = cursor.lastrowid
        conn.commit()
    
    log_timeline_event('task_created', title.strip())
    return get_focus_task(task_id)

def get_focus_task(task_id: int) -> Dict[str, Any]:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM focus_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise ValueError(f"Task {task_id} not found")
        return dict(row)

def update_focus_task(task_id: int, updates: Dict[str, Any]) -> Dict[str, Any]:
    allowed_keys = {'title', 'category', 'priority', 'completed', 'is_focus', 'due_date'}
    update_data = {k: v for k, v in updates.items() if k in allowed_keys}
    if not update_data:
        return get_focus_task(task_id)

    now = datetime.utcnow().isoformat()
    update_data['updated_at'] = now

    set_clause = ", ".join([f"{k} = ?" for k in update_data.keys()])
    values = list(update_data.values())

    with get_db_connection() as conn:
        if update_data.get('is_focus') is True or update_data.get('is_focus') == 1:
            conn.execute("UPDATE focus_tasks SET is_focus = 0")
            
        values.append(task_id)
        cursor = conn.execute(f"UPDATE focus_tasks SET {set_clause} WHERE id = ?", values)
        if cursor.rowcount == 0:
            raise ValueError(f"Task {task_id} not found")
        conn.commit()
        
    updated_task = get_focus_task(task_id)
    if 'completed' in updates:
        if updates['completed']:
            log_timeline_event('task_completed', updated_task['title'])
        else:
            log_timeline_event('task_reopened', updated_task['title'])
    elif 'is_focus' in updates and updates['is_focus']:
        log_timeline_event('focus_changed', updated_task['title'])
        
    return updated_task

def delete_focus_task(task_id: int) -> bool:
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM focus_tasks WHERE id = ?", (task_id,))
        conn.commit()
        return cursor.rowcount > 0

# -----------------------------------------------------------------------------
# IDEAS & DECISIONS
# -----------------------------------------------------------------------------
def get_focus_ideas() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM focus_ideas WHERE status = 'active' ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

def create_focus_idea(content: str, source: str = 'dump') -> Optional[Dict[str, Any]]:
    # Dedup
    ideas = get_focus_ideas()
    if _is_duplicate(content, [i['content'] for i in ideas]):
        for i in ideas:
            if _is_duplicate(content, [i['content']]):
                return i

    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO focus_ideas (content, status, source, created_at) VALUES (?, 'active', ?, ?)",
            (content.strip(), source, now)
        )
        idea_id = cursor.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM focus_ideas WHERE id = ?", (idea_id,)).fetchone()
    
    log_timeline_event('idea_saved', content.strip())
    return dict(row)

def get_focus_decisions() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM focus_decisions ORDER BY created_at DESC LIMIT 50").fetchall()
        return [dict(r) for r in rows]

def create_focus_decision(content: str, source: str = 'dump') -> Optional[Dict[str, Any]]:
    # Dedup
    decisions = get_focus_decisions()
    if _is_duplicate(content, [d['content'] for d in decisions]):
        for d in decisions:
            if _is_duplicate(content, [d['content']]):
                return d

    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO focus_decisions (content, source, created_at) VALUES (?, ?, ?)",
            (content.strip(), source, now)
        )
        decision_id = cursor.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM focus_decisions WHERE id = ?", (decision_id,)).fetchone()
    
    log_timeline_event('decision_saved', content.strip())
    return dict(row)

# -----------------------------------------------------------------------------
# TIMELINE
# -----------------------------------------------------------------------------
def log_timeline_event(event_type: str, title: str, details: Dict[str, Any] = None):
    now = datetime.utcnow().isoformat()
    details_str = json.dumps(details or {})
    with get_db_connection() as conn:
        conn.execute(
            "INSERT INTO focus_timeline (event_type, title, details, created_at) VALUES (?, ?, ?, ?)",
            (event_type, title, details_str, now)
        )
        conn.commit()

def get_focus_timeline() -> List[Dict[str, Any]]:
    # Retorna eventos de hoje
    today = datetime.utcnow().date().isoformat()
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM focus_timeline WHERE created_at >= ? ORDER BY created_at DESC LIMIT 100", (today,)).fetchall()
        return [dict(r) for r in rows]

# -----------------------------------------------------------------------------
# INBOX
# -----------------------------------------------------------------------------
def get_focus_inbox() -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute("SELECT * FROM focus_inbox WHERE status = 'pending' ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]

def create_focus_inbox_item(item_type: str, content: str, metadata: Dict[str, Any] = None, source: str = 'chat') -> Optional[Dict[str, Any]]:
    # Deduplication check com normalização
    inbox_items = get_focus_inbox()
    if _is_duplicate(content, [i['content'] for i in inbox_items]):
        return None # Ignora duplicatas

    now = datetime.utcnow().isoformat()
    metadata_str = json.dumps(metadata or {})
    with get_db_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO focus_inbox (item_type, content, metadata, source, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
            (item_type, content, metadata_str, source, now)
        )
        item_id = cursor.lastrowid
        conn.commit()
        row = conn.execute("SELECT * FROM focus_inbox WHERE id = ?", (item_id,)).fetchone()
    return dict(row)

def update_focus_inbox_status(item_id: int, status: str) -> bool:
    if status not in ['approved', 'ignored']:
        return False
    with get_db_connection() as conn:
        cursor = conn.execute("UPDATE focus_inbox SET status = ? WHERE id = ?", (status, item_id))
        conn.commit()
        return cursor.rowcount > 0

# -----------------------------------------------------------------------------
# CLASSIFICADOR V2 (Analyze Input)
# -----------------------------------------------------------------------------
def analyze_focus_input(text: str) -> Dict[str, Any]:
    # Buscar contexto atual de tarefas abertas para match de UPDATE
    tasks = get_focus_tasks()
    open_tasks = [t for t in tasks if not t.get('completed')]
    open_tasks_text = "\\n".join([f"ID: {t['id']} | Titulo: {t['title']}" for t in open_tasks])
    if not open_tasks_text:
        open_tasks_text = "(nenhuma tarefa aberta)"

    prompt = f"""Você é o classificador do Buds Focus.
O usuário enviou uma atualização ou pensamento sobre o dia dele.
Analise a entrada e classifique-a estruturadamente.

Sua resposta DEVE ser um objeto JSON no seguinte formato exato:
{{
  "items": [
    {{
      "type": "TASK" | "UPDATE" | "IDEA" | "DECISION" | "NOTE" | "IGNORE",
      "content": "descrição ou título da intenção",
      "action": "complete_task" | "create_task" | "save_idea" | "save_decision" | "none",
      "related_task_id": 123 (opcional, ID numérico da tarefa caso type seja UPDATE),
      "category": "work" | "study" | "personal" | "project" | "other" (apenas se for TASK),
      "priority": "low" | "medium" | "high" (apenas se for TASK),
      "confidence": 0.0 a 1.0
    }}
  ]
}}

Tarefas abertas no momento:
{open_tasks_text}

Regras:
1. TASK: algo que precisa ser feito.
2. UPDATE: usuário atualizou o status de algo (ex: 'terminei o relatorio'). Identifique o related_task_id correspondente acima, se houver.
3. IDEA: ideia, sugestão, criatividade. Não exige ação imediata.
4. DECISION: uma decisão tomada pelo usuário.
5. NOTE: comentário neutro, sem ação.
6. IGNORE: coisas inúteis (ex: 'oi', 'kkk', 'deu bom').

Entrada do usuário:
\"\"\"{text}\"\"\"

Responda APENAS com o JSON. NADA MAIS.
"""
    
    try:
        response_text = agenty.llm_ollama_raw(prompt)
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}')
        if start_idx != -1 and end_idx != -1:
            clean_json = response_text[start_idx:end_idx+1]
        else:
            clean_json = response_text

        data = json.loads(clean_json)
        return {"items": data.get("items", [])}
    except Exception as e:
        print(f"[Focus] Analyze Input error: {e}")
        return {"items": [], "error": str(e)}

# -----------------------------------------------------------------------------
# BUDS THINK (Aconselhamento Contextual)
# -----------------------------------------------------------------------------
def buds_think(query: str) -> str:
    tasks = get_focus_tasks()
    open_tasks = [t for t in tasks if not t.get('completed')]
    completed_today = [t for t in tasks if t.get('completed') and t.get('updated_at', '').startswith(datetime.utcnow().isoformat()[:10])]
    
    open_text = "\\n".join([f"- {t['title']} ({t['priority']}, {t['category']})" for t in open_tasks]) or "(nenhuma)"
    completed_text = "\\n".join([f"- {t['title']}" for t in completed_today]) or "(nenhuma)"
    
    prompt = f"""Você é o Buds, o assistente pessoal local do usuário.
Você está no modo 'Buds Think', ajudando o usuário a pensar sobre o dia e prioridades.
Neste modo, você NÃO cria tarefas. Você apenas dá conselhos, analisa o panorama ou responde a dúvida baseando-se no foco atual.

DADOS DO FOCUS DE HOJE:
Tarefas Abertas:
{open_text}

Tarefas Concluídas Hoje:
{completed_text}

MENSAGEM DO USUÁRIO:
"{query}"

Responda de forma natural, humana, direta e amigável, em português.
Não use linguagem corporativa robótica. Seja conciso e perspicaz.
"""
    try:
        response = agenty.llm_ollama_raw(prompt)
        # Remove think tags se o Qwen vazar
        import re
        clean_response = re.sub(r'<think>.*?</think>', '', response, flags=re.DOTALL).strip()
        
        log_timeline_event('buds_think', "O usuário pediu conselho ao Buds Think")
        return clean_response
    except Exception as e:
        print(f"[Focus] Buds Think error: {e}")
        return "Tive um problema ao analisar o seu foco no momento."

# Mantemos process_brain_dump temporariamente para retrocompatibilidade se algo quebrar, mas deve ser deprecado.
def process_brain_dump(text: str) -> List[Dict[str, Any]]:
    res = analyze_focus_input(text)
    tasks = []
    for item in res.get("items", []):
        if item.get("type") == "TASK" or item.get("type") == "task":
            tasks.append({
                "title": item.get("content", "Sem título"),
                "category": item.get("category", "other"),
                "priority": item.get("priority", "medium")
            })
    return tasks
