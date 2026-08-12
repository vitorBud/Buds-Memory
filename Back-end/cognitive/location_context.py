"""Contexto semântico efêmero derivado da infraestrutura de localização.

Não lê sensores, não persiste coordenadas e não chama o modelo. A função pura
``derive_context`` recebe apenas registros já existentes e produz um snapshot
pequeno para Chat, Focus e diagnóstico.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Optional

from cognitive import location


TRANSITION_TTL_SECONDS = 10 * 60
RECENT_EVENT_TTL_SECONDS = 45 * 60
HIGH_TTL_SECONDS = 5 * 60
MEDIUM_TTL_SECONDS = 15 * 60

LOCATION_TERMS = re.compile(
    r"\b(casa|trabalho|academia|faculdade|estudo|localizacao|onde estou|"
    r"chegar|cheguei|saindo|sair|trajeto|caminho|percurso|rota|deslocamento|"
    r"focus|tarefa|lembrete)\b"
)
EXPLICIT_LOCATION_QUERY = re.compile(
    r"\b(onde estou|onde exatamente estou|qual (?:e |é )?(?:a )?minha localizacao|minha localizacao|"
    r"localizacao atual|em que lugar (?:estou|eu estou))\b"
)
EXACT_LOCATION_QUERY = re.compile(
    r"\b(onde estou|onde exatamente estou|localizacao exata|minha localizacao|"
    r"localizacao atual|coordenadas?|latitude|longitude|em que lugar (?:estou|eu estou))\b"
)
DESTINATION_QUERY = re.compile(r"\b(para onde (?:eu )?(?:vou|estou indo)|onde (?:eu )?estou indo|qual (?:e |é )?(?:o )?destino|destino provável)\b")
CASUAL_OPENING = re.compile(
    r"^(e+\s*a[iy]+|eai|oi+|ola+|bom dia|boa tarde|boa noite|fala|"
    r"tudo bem|como voce esta|e agora|cheguei|partiu|finalmente)"
    r"(?:\s+(?:chat|buds))?[!,.?\s]*$"
)
CONTEXTUAL_MOVEMENT = re.compile(
    r"^(?:(?:eu\s+)?(?:to|estou)\s+indo\b|indo\s+resolver\b|"
    r"saindo\s+agora\b|ja\s+to\s+na\s+rua\b).{0,48}$"
)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def _age_seconds(value: Any, now: datetime) -> Optional[int]:
    parsed = _parse_datetime(value)
    if not parsed:
        return None
    return max(0, int((now - parsed.astimezone(timezone.utc)).total_seconds()))


def _place_payload(record: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not record:
        return None
    name = record.get("place_name") or record.get("name")
    context = record.get("context")
    if not name and context not in {"home", "work", "gym", "study", "other"}:
        return None
    return {
        "id": record.get("place_id", record.get("id")),
        "name": name or _context_label(context),
        "type": context or "other",
    }


def _context_label(context: Any) -> str:
    return {
        "home": "Casa",
        "work": "Trabalho",
        "gym": "Academia",
        "study": "Estudo",
        "other": "Lugar conhecido",
    }.get(str(context or ""), "Lugar conhecido")


def _transition_state(prefix: str, context: Any) -> Optional[str]:
    if context == "home":
        return f"{prefix}_HOME"
    if context == "work":
        return f"{prefix}_WORK"
    return None


def _stable_state(state: dict[str, Any], trip_active: bool) -> str:
    if trip_active or state.get("context") == "commuting":
        return "COMMUTING"
    is_confirmed_place = state.get("place_id") is not None or state.get("status") == "inside"
    is_explicit_manual_context = (
        state.get("status") == "manual"
        and state.get("context") in {"home", "work", "gym", "study", "other"}
    )
    if is_confirmed_place or is_explicit_manual_context:
        if state.get("context") == "home":
            return "AT_HOME"
        if state.get("context") == "work":
            return "AT_WORK"
        return "AT_KNOWN_PLACE"
    return "UNKNOWN"


def _semantic_event(event_type: str, context: Any) -> str:
    suffix = {
        "home": "HOME",
        "work": "WORK",
        "gym": "GYM",
        "study": "STUDY",
        "other": "KNOWN_PLACE",
    }.get(str(context or ""), "KNOWN_PLACE")
    if event_type == "enter":
        return f"ARRIVED_{suffix}"
    if event_type == "exit":
        return f"LEFT_{suffix}"
    return "CONTEXT_CHANGED"


def _event_candidates(
    events: list[dict[str, Any]],
    active_trip: Optional[dict[str, Any]],
    recent_trip: Optional[dict[str, Any]],
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    for event in events:
        if event.get("event_type") not in {"enter", "exit", "context_changed"}:
            continue
        candidates.append({
            "type": _semantic_event(str(event.get("event_type")), event.get("context")),
            "raw_type": event.get("event_type"),
            "place": _place_payload(event),
            "context": event.get("context"),
            "occurred_at": event.get("created_at"),
        })
    if active_trip:
        candidates.append({
            "type": "TRIP_STARTED",
            "raw_type": "trip_started",
            "place": None,
            "context": "commuting",
            "occurred_at": active_trip.get("started_at"),
        })
    elif recent_trip and recent_trip.get("ended_at"):
        candidates.append({
            "type": "TRIP_STOPPED",
            "raw_type": "trip_stopped",
            "place": None,
            "context": recent_trip.get("status"),
            "occurred_at": recent_trip.get("ended_at"),
        })
    return candidates


def _trip_origin(
    active_trip: Optional[dict[str, Any]],
    events: list[dict[str, Any]],
    now: datetime,
) -> Optional[dict[str, Any]]:
    if not active_trip:
        return None
    started = _parse_datetime(active_trip.get("started_at"))
    if not started:
        return None
    exits = [event for event in events if event.get("event_type") == "exit"]
    for event in sorted(exits, key=lambda item: str(item.get("created_at") or ""), reverse=True):
        event_time = _parse_datetime(event.get("created_at"))
        if not event_time:
            continue
        delta = abs((event_time - started).total_seconds())
        if delta <= TRANSITION_TTL_SECONDS:
            return _place_payload(event)
    return None


def _learn_transition_pattern(
    events: list[dict[str, Any]],
    origin: Optional[dict[str, Any]],
) -> Optional[dict[str, Any]]:
    """Aprende transições repetidas de lugar sem modelo e sem gravar um perfil novo."""
    if not origin:
        return None
    origin_type = origin.get("type")
    chronological = sorted(events, key=lambda item: str(item.get("created_at") or ""))
    transitions: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for index, event in enumerate(chronological):
        if event.get("event_type") != "exit" or event.get("context") != origin_type:
            continue
        exited_at = _parse_datetime(event.get("created_at"))
        if not exited_at:
            continue
        for candidate in chronological[index + 1:]:
            arrived_at = _parse_datetime(candidate.get("created_at"))
            if not arrived_at:
                continue
            elapsed = (arrived_at - exited_at).total_seconds()
            if elapsed > 6 * 60 * 60:
                break
            if candidate.get("event_type") == "enter" and candidate.get("context") != origin_type:
                destination = _place_payload(candidate)
                if destination:
                    transitions.append((destination, candidate))
                break
    if not transitions:
        return None

    counts: dict[str, int] = {}
    places: dict[str, dict[str, Any]] = {}
    arrival_minutes: dict[str, list[int]] = {}
    for destination, event in transitions:
        key = str(destination.get("type") or destination.get("name"))
        counts[key] = counts.get(key, 0) + 1
        places[key] = destination
        arrived_at = _parse_datetime(event.get("created_at"))
        if arrived_at:
            arrival_minutes.setdefault(key, []).append(arrived_at.hour * 60 + arrived_at.minute)
    winner = max(counts, key=counts.get)
    samples = counts[winner]
    confidence = samples / max(1, sum(counts.values()))
    # Duas ocorrências ainda podem ser coincidência. Só fazemos previsão após
    # três transições e com maioria clara.
    if samples < 3 or confidence < 0.60:
        return None
    minutes = sorted(arrival_minutes.get(winner) or [])
    typical_minute = minutes[len(minutes) // 2] if minutes else None
    return {
        "kind": "PLACE_TRANSITION",
        "origin": origin,
        "destination": places[winner],
        "sample_count": samples,
        "total_transitions": sum(counts.values()),
        "confidence": round(confidence, 3),
        "typical_arrival_time": (
            f"{typical_minute // 60:02d}:{typical_minute % 60:02d}"
            if typical_minute is not None else None
        ),
    }


def derive_context(
    *,
    state: Optional[dict[str, Any]],
    events: Optional[list[dict[str, Any]]],
    active_trip: Optional[dict[str, Any]],
    recent_trip: Optional[dict[str, Any]],
    now: Optional[datetime] = None,
) -> dict[str, Any]:
    """Deriva um snapshot sem coordenadas e sem efeitos colaterais."""
    current_time = (now or _utc_now()).astimezone(timezone.utc)
    current_state = state or {}
    ordered_events = sorted(
        events or [], key=lambda item: str(item.get("created_at") or ""), reverse=True
    )
    trip_active = bool(active_trip and active_trip.get("status") == "active")
    current_place = _place_payload(current_state)
    origin = _trip_origin(active_trip, ordered_events, current_time)

    candidates = _event_candidates(ordered_events, active_trip, recent_trip)
    candidates = [
        {**candidate, "age_seconds": _age_seconds(candidate.get("occurred_at"), current_time)}
        for candidate in candidates
    ]
    candidates = [candidate for candidate in candidates if candidate["age_seconds"] is not None]
    candidates.sort(key=lambda item: int(item["age_seconds"]))
    recent_event = candidates[0] if candidates and int(candidates[0]["age_seconds"]) <= RECENT_EVENT_TTL_SECONDS else None

    semantic_state = _stable_state(current_state, trip_active)
    latest_location_event = next(
        (event for event in ordered_events if event.get("event_type") in {"enter", "exit"}),
        None,
    )
    location_event_age = _age_seconds(latest_location_event.get("created_at"), current_time) if latest_location_event else None
    if latest_location_event and location_event_age is not None and location_event_age <= TRANSITION_TTL_SECONDS:
        if latest_location_event.get("event_type") == "enter" and current_place:
            semantic_state = _transition_state("ARRIVING", latest_location_event.get("context")) or "AT_KNOWN_PLACE"
        elif latest_location_event.get("event_type") == "exit" and not current_place:
            semantic_state = _transition_state("LEAVING", latest_location_event.get("context")) or (
                "COMMUTING" if trip_active else "UNKNOWN"
            )

    event_age = int(recent_event["age_seconds"]) if recent_event else None
    if event_age is not None and event_age <= HIGH_TTL_SECONDS:
        relevance = "HIGH"
    elif event_age is not None and event_age <= MEDIUM_TTL_SECONDS:
        relevance = "MEDIUM"
    elif event_age is not None:
        relevance = "LOW"
    elif trip_active:
        trip_age = _age_seconds(active_trip.get("started_at"), current_time) if active_trip else None
        relevance = "MEDIUM" if trip_age is not None and trip_age <= 60 * 60 else "LOW"
    elif current_place:
        relevance = "LOW"
    else:
        relevance = "NONE"

    # Estar dentro de uma geofence não prova imobilidade. Sem uma amostra de
    # velocidade recente e confiável, o estado físico permanece desconhecido.
    movement = "MOVING" if trip_active or current_state.get("context") == "commuting" else "UNKNOWN"
    previous_place = origin
    if (
        not previous_place
        and latest_location_event
        and latest_location_event.get("event_type") == "exit"
        and location_event_age is not None
        and location_event_age <= RECENT_EVENT_TTL_SECONDS
    ):
        previous_place = _place_payload(latest_location_event)

    prediction_origin = origin or previous_place
    routine = _learn_transition_pattern(ordered_events, prediction_origin)
    predicted_destination = routine.get("destination") if routine else None

    return {
        "version": 1,
        "current_place": current_place,
        "previous_place": previous_place,
        "state": semantic_state,
        "movement": movement,
        "trip_active": trip_active,
        "trip_origin": origin,
        "trip_destination": predicted_destination,
        "destination_confidence": routine.get("confidence") if routine else None,
        "routine": routine,
        "trip_duration_seconds": int((active_trip or recent_trip or {}).get("duration_s") or 0),
        "recent_event": recent_event["type"] if recent_event else None,
        "recent_event_at": recent_event["occurred_at"] if recent_event else None,
        "recent_event_age_seconds": event_age,
        "relevance": relevance,
    }


def current_context(now: Optional[datetime] = None) -> dict[str, Any]:
    active_trip = location.get_active_route(include_points=False)
    recent_trip = active_trip or next(iter(location.list_routes(limit=1)), None)
    return derive_context(
        state=location.get_state(),
        # Até 200 transições pequenas permitem aprender padrões locais sem ler
        # pontos de rota e sem criar processamento em background.
        events=location.get_recent_events(limit=200),
        active_trip=active_trip,
        recent_trip=recent_trip,
        now=now,
    )


def _normalize_query(text: str) -> str:
    value = unicodedata.normalize("NFD", text or "")
    normalized = "".join(char for char in value if unicodedata.category(char) != "Mn").lower()
    return re.sub(r"\s+", " ", normalized).strip()


def should_attach_to_chat(user_text: str, snapshot: dict[str, Any]) -> bool:
    """Prefiltro barato: contexto alto não contamina perguntas sem relação."""
    relevance = snapshot.get("relevance", "NONE")
    normalized = _normalize_query(user_text)
    # Uma pergunta explícita sobre a posição precisa receber UNKNOWN quando a
    # localização não estiver disponível; omitir o snapshot favorece invenção.
    if EXPLICIT_LOCATION_QUERY.search(normalized):
        return True
    if DESTINATION_QUERY.search(normalized) and snapshot.get("trip_destination"):
        return True
    if relevance == "NONE":
        return False
    if LOCATION_TERMS.search(normalized):
        return True
    if (
        relevance in {"HIGH", "MEDIUM"}
        and snapshot.get("state") == "COMMUTING"
        and CONTEXTUAL_MOVEMENT.match(normalized)
    ):
        return True
    if relevance == "HIGH" and len(normalized) <= 56 and CASUAL_OPENING.match(normalized):
        return True
    return False


def context_for_chat(user_text: str, now: Optional[datetime] = None) -> str:
    try:
        snapshot = current_context(now=now)
    except Exception:
        # Localização é contexto suplementar. Banco indisponível, permissão
        # negada ou ausência de amostra nunca podem interromper o Chat.
        return ""
    if not should_attach_to_chat(user_text, snapshot):
        return ""
    lines = [
        "CONTEXTO LOCAL EFÊMERO (gerado por código; não é memória):",
        f"- estado: {snapshot['state']}",
        f"- movimento: {snapshot['movement']}",
        f"- trajeto ativo: {'sim' if snapshot['trip_active'] else 'não'}",
        f"- relevância: {snapshot['relevance']}",
    ]
    if snapshot.get("current_place"):
        lines.append(f"- lugar atual: {snapshot['current_place']['name']}")
    if snapshot.get("previous_place"):
        lines.append(f"- lugar anterior: {snapshot['previous_place']['name']}")
    if snapshot.get("trip_origin"):
        lines.append(f"- origem do trajeto: {snapshot['trip_origin']['name']}")
    if snapshot.get("trip_destination"):
        lines.append(
            f"- destino provável: {snapshot['trip_destination']['name']} "
            f"(confiança {int(float(snapshot.get('destination_confidence') or 0) * 100)}%; é previsão, não fato)"
        )
    elif snapshot.get("trip_active"):
        lines.append("- destino do trajeto: desconhecido")
    if snapshot.get("recent_event"):
        lines.append(
            f"- evento recente: {snapshot['recent_event']} há "
            f"{snapshot['recent_event_age_seconds']} segundos"
        )
    normalized = _normalize_query(user_text)
    if EXACT_LOCATION_QUERY.search(normalized):
        try:
            exact_state = location.get_state()
            latitude = exact_state.get("latitude")
            longitude = exact_state.get("longitude")
            accuracy = exact_state.get("accuracy_m")
            if latitude is not None and longitude is not None:
                lines.append(f"- latitude local: {float(latitude):.6f}")
                lines.append(f"- longitude local: {float(longitude):.6f}")
                if accuracy is not None:
                    lines.append(f"- precisão estimada: {round(float(accuracy))} metros")
                updated_age = _age_seconds(exact_state.get("updated_at"), now or _utc_now())
                if updated_age is not None:
                    lines.append(f"- idade da última posição: {updated_age} segundos")
        except Exception:
            pass
    lines.append(
        "Use isso somente se encaixar naturalmente na mensagem atual. "
        "Ignore em perguntas técnicas ou sem relação. O contexto é suplementar. "
        "Não mencione rastreamento ou sensores; só repita coordenadas se o usuário pediu a localização. "
        "Nunca apresente destino provável como confirmado; trate UNKNOWN como incerto."
    )
    return "\n".join(lines)
