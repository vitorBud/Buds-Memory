import json
import sqlite3
from typing import List, Dict, Any, Optional
from datetime import datetime
from database_v2 import get_db_connection
import agenty
from cognitive import memory as cognitive_memory
from cognitive import location as cognitive_location
from cognitive.focus_capture import candidate_key, detect_focus_candidates
from cognitive.response_safety import sanitize_response

import re
import string

FOCUS_CATEGORIES = {'work', 'study', 'personal', 'project', 'other'}
FOCUS_PRIORITIES = {'low', 'medium', 'high'}
FOCUS_ITEM_TYPES = {'TASK', 'REMINDER', 'UPDATE', 'IDEA', 'DECISION', 'MEMORY', 'NOTE', 'IGNORE'}
FOCUS_ACTIONS = {'complete_task', 'create_task', 'save_idea', 'save_decision', 'save_memory', 'none'}
FOCUS_PLACE_CONTEXTS = {'anywhere', 'home', 'work', 'gym', 'study', 'other'}

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
        rows = conn.execute("""
            SELECT * FROM focus_tasks
            ORDER BY completed ASC,
                     CASE priority WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
                     created_at DESC
        """).fetchall()
        tasks = [dict(r) for r in rows]
    try:
        current_context = cognitive_location.get_state().get('context', 'unknown')
    except sqlite3.OperationalError:
        # Compatibilidade com bancos/testes que ainda não executaram a migração
        # de localização. O Focus continua funcional até o próximo migrate().
        current_context = 'unknown'
    for task in tasks:
        place_context = task.get('place_context') or 'anywhere'
        task['location_relevant'] = place_context == 'anywhere' or place_context == current_context
        task['current_location_context'] = current_context
    tasks.sort(key=lambda task: 0 if task['location_relevant'] else 1)
    return tasks

def create_focus_task(
    title: str,
    category: str = 'other',
    priority: str = 'medium',
    is_focus: bool = False,
    due_date: Optional[str] = None,
    *,
    item_type: str = 'TASK',
    source: str = 'manual',
    source_session_id: Optional[str] = None,
    source_message_id: Optional[int] = None,
    dedup_key: Optional[str] = None,
    confidence: float = 1.0,
    place_context: str = 'anywhere',
    trigger_on_arrival: bool = False,
) -> Optional[Dict[str, Any]]:
    title = (title or '').strip()
    if not title:
        raise ValueError("O título da tarefa não pode ficar vazio.")
    category = category if category in FOCUS_CATEGORIES else 'other'
    priority = priority if priority in FOCUS_PRIORITIES else 'medium'
    item_type = item_type if item_type in {'TASK', 'REMINDER'} else 'TASK'
    place_context = place_context if place_context in FOCUS_PLACE_CONTEXTS else 'anywhere'
    trigger_on_arrival = bool(trigger_on_arrival and place_context != 'anywhere')
    dedup_key = dedup_key or candidate_key(item_type, title, due_date, place_context)
    confidence = min(1.0, max(0.0, float(confidence)))
    # Dedup
    tasks = get_focus_tasks()
    open_tasks = [
        t['title'] for t in tasks
        if not t.get('completed') and (t.get('place_context') or 'anywhere') == place_context
    ]
    if _is_duplicate(title, open_tasks):
        # Encontra a tarefa existente
        for t in tasks:
            if (
                not t.get('completed')
                and (t.get('place_context') or 'anywhere') == place_context
                and _is_duplicate(title, [t['title']])
            ):
                return t

    now = datetime.utcnow().isoformat()
    with get_db_connection() as conn:
        existing = conn.execute(
            "SELECT * FROM focus_tasks WHERE dedup_key = ? AND completed = 0 LIMIT 1",
            (dedup_key,),
        ).fetchone()
        if existing:
            return dict(existing)
        if is_focus:
            conn.execute("UPDATE focus_tasks SET is_focus = 0")
        try:
            cursor = conn.execute(
                """INSERT INTO focus_tasks
                   (title, category, priority, completed, is_focus, created_at, updated_at,
                    due_date, item_type, source, source_session_id, source_message_id,
                    dedup_key, confidence, place_context, trigger_on_arrival)
                   VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    title[:500], category, priority, 1 if is_focus else 0, now, now,
                    due_date, item_type, source[:40], source_session_id,
                    source_message_id, dedup_key, confidence, place_context,
                    1 if trigger_on_arrival else 0,
                ),
            )
        except sqlite3.IntegrityError:
            existing = conn.execute(
                "SELECT * FROM focus_tasks WHERE dedup_key = ? AND completed = 0 LIMIT 1",
                (dedup_key,),
            ).fetchone()
            if existing:
                return dict(existing)
            raise
        task_id = cursor.lastrowid
        conn.commit()

    log_timeline_event(
        'reminder_created' if item_type == 'REMINDER' else 'task_created',
        title,
        {'source': source, 'session_id': source_session_id, 'due_date': due_date,
         'place_context': place_context, 'trigger_on_arrival': trigger_on_arrival},
    )
    return get_focus_task(task_id)

def get_focus_task(task_id: int) -> Dict[str, Any]:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM focus_tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise ValueError(f"Task {task_id} not found")
        return dict(row)

def update_focus_task(task_id: int, updates: Dict[str, Any]) -> Dict[str, Any]:
    allowed_keys = {'title', 'category', 'priority', 'completed', 'is_focus', 'due_date', 'place_context', 'trigger_on_arrival'}
    update_data = {k: v for k, v in updates.items() if k in allowed_keys}
    if 'title' in update_data:
        update_data['title'] = str(update_data['title'] or '').strip()[:500]
        if not update_data['title']:
            raise ValueError("O título da tarefa não pode ficar vazio.")
    if 'category' in update_data and update_data['category'] not in FOCUS_CATEGORIES:
        update_data['category'] = 'other'
    if 'priority' in update_data and update_data['priority'] not in FOCUS_PRIORITIES:
        update_data['priority'] = 'medium'
    if 'place_context' in update_data and update_data['place_context'] not in FOCUS_PLACE_CONTEXTS:
        update_data['place_context'] = 'anywhere'
    if 'trigger_on_arrival' in update_data:
        effective_place = update_data.get('place_context') or get_focus_task(task_id).get('place_context', 'anywhere')
        update_data['trigger_on_arrival'] = 1 if bool(update_data['trigger_on_arrival']) and effective_place != 'anywhere' else 0
    elif update_data.get('place_context') == 'anywhere':
        update_data['trigger_on_arrival'] = 0
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

def create_focus_inbox_item(
    item_type: str,
    content: str,
    metadata: Dict[str, Any] = None,
    source: str = 'chat',
    dedup_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    # Deduplication check com normalização
    inbox_items = get_focus_inbox()
    if _is_duplicate(content, [i['content'] for i in inbox_items]):
        return None # Ignora duplicatas

    now = datetime.utcnow().isoformat()
    metadata = metadata or {}
    dedup_key = dedup_key or candidate_key(
        item_type, content, metadata.get('due_date'), metadata.get('place_context', 'anywhere')
    )
    metadata_str = json.dumps(metadata, ensure_ascii=False)
    with get_db_connection() as conn:
        existing = conn.execute(
            "SELECT * FROM focus_inbox WHERE dedup_key = ? AND status = 'pending' LIMIT 1",
            (dedup_key,),
        ).fetchone()
        if existing:
            return dict(existing)
        try:
            cursor = conn.execute(
                """INSERT INTO focus_inbox
                   (item_type, content, metadata, source, status, created_at, dedup_key)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?)""",
                (item_type, content, metadata_str, source, now, dedup_key),
            )
        except sqlite3.IntegrityError:
            return None
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

def resolve_focus_inbox_item(item_id: int, status: str) -> bool:
    """Aprova/aplica ou ignora um item sem marcar como concluído antes da persistência."""
    if status not in {'approved', 'ignored'}:
        return False
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT * FROM focus_inbox WHERE id = ? AND status = 'pending'",
            (item_id,),
        ).fetchone()
    if not row:
        return False
    item = dict(row)
    if status == 'approved':
        item_type = str(item.get('item_type') or '').upper()
        content = str(item.get('content') or '').strip()
        try:
            metadata = json.loads(item.get('metadata') or '{}')
        except (TypeError, json.JSONDecodeError):
            metadata = {}
        if item_type in {'TASK', 'REMINDER'}:
            create_focus_task(
                content,
                category=metadata.get('category', 'other'),
                priority=metadata.get('priority', 'medium'),
                due_date=metadata.get('due_date'),
                item_type=item_type,
                source='inbox',
                source_session_id=metadata.get('session_id'),
                source_message_id=metadata.get('message_id'),
                dedup_key=item.get('dedup_key'),
                confidence=metadata.get('confidence', 0.75),
                place_context=metadata.get('place_context', 'anywhere'),
                trigger_on_arrival=metadata.get('trigger_on_arrival', False),
            )
        elif item_type == 'IDEA':
            create_focus_idea(content, source='inbox')
        elif item_type == 'DECISION':
            create_focus_decision(content, source='inbox')
        elif item_type == 'MEMORY':
            cognitive_memory.save_memory(
                content,
                memory_type='long',
                session_id=metadata.get('session_id'),
                importance=0.8,
                tags=['focus', 'confirmed'],
                user_confirmed=True,
                origin_type='focus_inbox',
                origin_id=str(item_id),
            )
    return update_focus_inbox_status(item_id, status)


def capture_chat_message(
    text: str,
    session_id: Optional[str] = None,
    source_message_id: Optional[int] = None,
) -> Dict[str, Any]:
    """Projeta intenções do Chat no Focus sem gastar uma segunda inferência."""
    created: List[Dict[str, Any]] = []
    suggested: List[Dict[str, Any]] = []
    for candidate in detect_focus_candidates(text):
        metadata = {
            'session_id': session_id,
            'message_id': source_message_id,
            'category': candidate.get('category', 'other'),
            'priority': candidate.get('priority', 'medium'),
            'due_date': candidate.get('due_date'),
            'confidence': candidate.get('confidence', 0.5),
            'place_context': candidate.get('place_context', 'anywhere'),
            'trigger_on_arrival': candidate.get('trigger_on_arrival', False),
        }
        if candidate.get('auto_apply') and candidate['type'] in {'TASK', 'REMINDER'}:
            task = create_focus_task(
                candidate['content'],
                category=candidate.get('category', 'other'),
                priority=candidate.get('priority', 'medium'),
                due_date=candidate.get('due_date'),
                item_type=candidate['type'],
                source='chat',
                source_session_id=session_id,
                source_message_id=source_message_id,
                dedup_key=candidate['dedup_key'],
                confidence=candidate.get('confidence', 1.0),
                place_context=candidate.get('place_context', 'anywhere'),
                trigger_on_arrival=candidate.get('trigger_on_arrival', False),
            )
            if task:
                created.append(task)
        else:
            item = create_focus_inbox_item(
                candidate['type'],
                candidate['content'],
                metadata=metadata,
                source='chat',
                dedup_key=candidate['dedup_key'],
            )
            if item:
                suggested.append(item)
    return {'created': created, 'suggested': suggested}

def _sanitize_analyzed_items(items: Any) -> List[Dict[str, Any]]:
    clean_items: List[Dict[str, Any]] = []
    if not isinstance(items, list):
        return clean_items
    for raw in items[:30]:
        if not isinstance(raw, dict):
            continue
        content = str(raw.get('content') or '').strip()
        if not content:
            continue
        item_type = str(raw.get('type') or 'NOTE').upper()
        action = str(raw.get('action') or 'none')
        safe_type = item_type if item_type in FOCUS_ITEM_TYPES else 'NOTE'
        default_action = {
            'TASK': 'create_task',
            'REMINDER': 'create_task',
            'IDEA': 'save_idea',
            'DECISION': 'save_decision',
            'MEMORY': 'save_memory',
        }.get(safe_type, 'none')
        safe_action = action if action in FOCUS_ACTIONS else default_action
        if safe_type in {'TASK', 'REMINDER', 'IDEA', 'DECISION', 'MEMORY'} and safe_action == 'none':
            safe_action = default_action
        clean: Dict[str, Any] = {
            'type': safe_type,
            'content': content[:2000],
            'action': safe_action,
        }
        related_task_id = raw.get('related_task_id')
        if isinstance(related_task_id, int) and related_task_id > 0:
            clean['related_task_id'] = related_task_id
        elif safe_type == 'UPDATE':
            clean['action'] = 'none'
        category = raw.get('category')
        if category in FOCUS_CATEGORIES:
            clean['category'] = category
        priority = raw.get('priority')
        if priority in FOCUS_PRIORITIES:
            clean['priority'] = priority
        due_date = raw.get('due_date')
        if isinstance(due_date, str) and due_date.strip():
            clean['due_date'] = due_date.strip()[:40]
        place_context = raw.get('place_context')
        if place_context in FOCUS_PLACE_CONTEXTS:
            clean['place_context'] = place_context
        clean['trigger_on_arrival'] = bool(raw.get('trigger_on_arrival', False))
        try:
            clean['confidence'] = min(1.0, max(0.0, float(raw.get('confidence', 0.5))))
        except (TypeError, ValueError):
            clean['confidence'] = 0.5
        clean_items.append(clean)
    return clean_items

# -----------------------------------------------------------------------------
# CLASSIFICADOR V2 (Analyze Input)
# -----------------------------------------------------------------------------
def analyze_focus_input(text: str) -> Dict[str, Any]:
    deterministic = detect_focus_candidates(text)
    if deterministic:
        return {"items": _sanitize_analyzed_items(deterministic), "source": "rules"}

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
      "type": "TASK" | "REMINDER" | "UPDATE" | "IDEA" | "DECISION" | "MEMORY" | "NOTE" | "IGNORE",
      "content": "descrição ou título da intenção",
      "action": "complete_task" | "create_task" | "save_idea" | "save_decision" | "save_memory" | "none",
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
2. REMINDER: algo que precisa ser lembrado em uma data ou horário.
3. UPDATE: usuário atualizou o status de algo (ex: 'terminei o relatorio'). Identifique o related_task_id correspondente acima, se houver.
4. IDEA: ideia, sugestão, criatividade. Não exige ação imediata.
5. DECISION: uma decisão tomada pelo usuário.
6. MEMORY: fato durável que o usuário pediu explicitamente para guardar.
7. NOTE: comentário neutro, sem ação.
8. IGNORE: coisas inúteis (ex: 'oi', 'kkk', 'deu bom').

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
        return {"items": _sanitize_analyzed_items(data.get("items", []))}
    except Exception as e:
        print(f"[Focus] Analyze Input error: {e}")
        return {"items": [], "error": str(e)}

# -----------------------------------------------------------------------------
# BUDS THINK (Aconselhamento Contextual)
# -----------------------------------------------------------------------------
def build_focus_brief() -> str:
    """Conselho determinístico para o Focus nunca depender do motor local."""
    tasks = [task for task in get_focus_tasks() if not task.get('completed')]
    if not tasks:
        pending = len(get_focus_inbox())
        if pending:
            return f"Você não tem tarefas abertas. Há {pending} sugestão{'ões' if pending != 1 else ''} na Buds Inbox para revisar."
        return "Seu dia está livre no Focus. Se surgir algo, diga no chat “hoje preciso…” ou “me lembra…”."

    ranked = sorted(
        tasks,
        key=lambda task: (
            0 if task.get('is_focus') else 1,
            {'high': 0, 'medium': 1, 'low': 2}.get(task.get('priority'), 1),
            task.get('due_date') or '9999',
        ),
    )
    first = ranked[0]
    due = first.get('due_date')
    due_copy = ''
    if due:
        try:
            parsed = datetime.fromisoformat(due)
            due_copy = f" até {parsed.strftime('%d/%m às %H:%M')}"
        except ValueError:
            due_copy = ''
    remaining = len(ranked) - 1
    suffix = f" Depois, ainda há {remaining} item{'s' if remaining != 1 else ''}." if remaining else ""
    return f"Comece por “{first['title']}”{due_copy}. É o item mais prioritário agora.{suffix}"


def buds_think(query: str) -> str:
    tasks = get_focus_tasks()
    open_tasks = [t for t in tasks if not t.get('completed')]
    completed_today = [t for t in tasks if t.get('completed') and t.get('updated_at', '').startswith(datetime.utcnow().isoformat()[:10])]
    
    open_text = "\\n".join([
        f"- {t['title']} ({t['priority']}, {t['category']}, lugar: {t.get('place_context', 'anywhere')})"
        for t in open_tasks
    ]) or "(nenhuma)"
    completed_text = "\\n".join([f"- {t['title']}" for t in completed_today]) or "(nenhuma)"
    
    prompt = f"""Você é o Buds, o assistente pessoal local do usuário.
Você está no modo 'Buds Think', ajudando o usuário a pensar sobre o dia e prioridades.
Neste modo, você NÃO cria tarefas. Você apenas dá conselhos, analisa o panorama ou responde a dúvida baseando-se no foco atual.

DADOS DO FOCUS DE HOJE:
Tarefas Abertas:
{open_text}

Tarefas Concluídas Hoje:
{completed_text}

{cognitive_location.semantic_context_for_prompt()}

MENSAGEM DO USUÁRIO:
"{query}"

Responda de forma natural, humana, direta e amigável, em português.
Não use linguagem corporativa robótica. Seja conciso e perspicaz.
"""
    try:
        response = agenty.llm_ollama_raw(prompt)
        clean_response = sanitize_response(response, user_text=query).strip()
        if not clean_response:
            return build_focus_brief()
        log_timeline_event('buds_think', "O usuário pediu conselho ao Buds Think")
        return clean_response
    except Exception as e:
        print(f"[Focus] Buds Think error: {e}")
        return build_focus_brief()

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
