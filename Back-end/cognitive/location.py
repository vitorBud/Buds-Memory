"""Contexto local de lugar e trajetos explícitos do Buds Memory.

Esta camada valida amostras locais, converte-as em Casa/Trabalho/Academia ou
deslocamento e registra mudanças de contexto. Coordenadas só podem chegar ao
prompt por pedido explícito do usuário; trilhas GPS continuam restritas a um
trajeto iniciado pelo usuário.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from typing import Any, Optional

from database_v2 import get_db_connection


PLACE_CONTEXTS = {"home", "work", "gym", "study", "other"}
STATE_CONTEXTS = {*PLACE_CONTEXTS, "commuting", "away", "unknown"}
SOURCES = {"core_location", "browser", "manual", "geofence", "significant_change", "system"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row(row) -> Optional[dict[str, Any]]:
    return dict(row) if row else None


def _validate_coordinate(latitude: float, longitude: float) -> tuple[float, float]:
    latitude = float(latitude)
    longitude = float(longitude)
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("Coordenadas inválidas.")
    return latitude, longitude


def _distance_m(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    radius = 6_371_000.0
    phi_a, phi_b = math.radians(lat_a), math.radians(lat_b)
    delta_phi = math.radians(lat_b - lat_a)
    delta_lon = math.radians(lon_b - lon_a)
    value = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi_a) * math.cos(phi_b) * math.sin(delta_lon / 2) ** 2
    )
    return radius * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def list_places(enabled_only: bool = False) -> list[dict[str, Any]]:
    where = "WHERE enabled = 1" if enabled_only else ""
    with get_db_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM location_places {where} ORDER BY enabled DESC, name COLLATE NOCASE"
        ).fetchall()
        return [dict(item) for item in rows]


def get_place(place_id: int) -> Optional[dict[str, Any]]:
    with get_db_connection() as conn:
        return _row(conn.execute("SELECT * FROM location_places WHERE id = ?", (place_id,)).fetchone())


def save_place(
    *,
    name: str,
    context: str,
    latitude: float,
    longitude: float,
    radius_m: float = 180,
    enabled: bool = True,
    place_id: Optional[int] = None,
) -> dict[str, Any]:
    name = (name or "").strip()[:80]
    if not name:
        raise ValueError("Dê um nome ao lugar.")
    context = context if context in PLACE_CONTEXTS else "other"
    latitude, longitude = _validate_coordinate(latitude, longitude)
    radius_m = min(1_000.0, max(75.0, float(radius_m)))
    now = _now()
    with get_db_connection() as conn:
        if place_id is None:
            cursor = conn.execute(
                """INSERT INTO location_places
                   (name, context, latitude, longitude, radius_m, enabled, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (name, context, latitude, longitude, radius_m, int(enabled), now, now),
            )
            place_id = int(cursor.lastrowid)
        else:
            cursor = conn.execute(
                """UPDATE location_places SET name=?, context=?, latitude=?, longitude=?,
                   radius_m=?, enabled=?, updated_at=? WHERE id=?""",
                (name, context, latitude, longitude, radius_m, int(enabled), now, int(place_id)),
            )
            if cursor.rowcount == 0:
                raise ValueError("Lugar não encontrado.")
        conn.commit()
    return get_place(int(place_id)) or {}


def delete_place(place_id: int) -> bool:
    with get_db_connection() as conn:
        active = conn.execute(
            "SELECT 1 FROM location_state WHERE id=1 AND place_id=?", (place_id,)
        ).fetchone()
        cursor = conn.execute("DELETE FROM location_places WHERE id = ?", (place_id,))
        if active and cursor.rowcount:
            conn.execute(
                """UPDATE location_state SET place_id=NULL, context='away', status='away',
                   source='system', updated_at=? WHERE id=1""",
                (_now(),),
            )
        conn.commit()
        return cursor.rowcount > 0


def get_state() -> dict[str, Any]:
    with get_db_connection() as conn:
        row = conn.execute(
            """SELECT s.*, p.name AS place_name, p.radius_m AS place_radius_m
               FROM location_state s LEFT JOIN location_places p ON p.id=s.place_id
               WHERE s.id=1"""
        ).fetchone()
    if row:
        return dict(row)
    return {
        "id": 1,
        "place_id": None,
        "place_name": None,
        "context": "unknown",
        "status": "unknown",
        "latitude": None,
        "longitude": None,
        "accuracy_m": None,
        "source": "system",
        "updated_at": None,
    }


def update_sample(
    latitude: float,
    longitude: float,
    *,
    accuracy_m: Optional[float] = None,
    altitude_m: Optional[float] = None,
    speed_mps: Optional[float] = None,
    recorded_at: Optional[str] = None,
    source: str = "browser",
) -> dict[str, Any]:
    latitude, longitude = _validate_coordinate(latitude, longitude)
    accuracy = None if accuracy_m is None else min(5_000.0, max(0.0, float(accuracy_m)))
    source = source if source in SOURCES else "system"
    places = list_places(enabled_only=True)
    nearest = None
    nearest_distance = float("inf")
    for place in places:
        distance = _distance_m(latitude, longitude, place["latitude"], place["longitude"])
        if distance <= float(place["radius_m"]) and distance < nearest_distance:
            nearest, nearest_distance = place, distance

    previous = get_state()
    next_place_id = nearest["id"] if nearest else None
    next_context = nearest["context"] if nearest else (
        "commuting" if source == "significant_change" else "away"
    )
    next_status = "inside" if nearest else "away"
    now = _now()
    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO location_state
               (id, place_id, context, status, latitude, longitude, accuracy_m, source, updated_at)
               VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET place_id=excluded.place_id, context=excluded.context,
               status=excluded.status, latitude=excluded.latitude, longitude=excluded.longitude,
               accuracy_m=excluded.accuracy_m, source=excluded.source, updated_at=excluded.updated_at""",
            (next_place_id, next_context, next_status, latitude, longitude, accuracy, source, now),
        )
        if previous.get("place_id") != next_place_id:
            if previous.get("place_id") is not None:
                conn.execute(
                    "INSERT INTO location_events (place_id,event_type,context,source,created_at) VALUES (?,?,?,?,?)",
                    (previous["place_id"], "exit", previous.get("context", "other"), source, now),
                )
            if next_place_id is not None:
                conn.execute(
                    "INSERT INTO location_events (place_id,event_type,context,source,created_at) VALUES (?,?,?,?,?)",
                    (next_place_id, "enter", next_context, source, now),
                )
        conn.commit()
    state = get_state()
    state["distance_m"] = round(nearest_distance, 1) if nearest else None
    state["changed"] = previous.get("place_id") != next_place_id
    triggered_reminders: list[dict[str, Any]] = []
    if state["changed"] and nearest is not None:
        try:
            # Import local evita ciclo: Focus usa a localização para ordenar.
            from cognitive import focus as cognitive_focus
            triggered_reminders = cognitive_focus.trigger_arrival_reminders(next_context)
        except Exception as exc:
            # Automação é complementar e nunca invalida a amostra de GPS.
            print(f"[Location] Lembretes de chegada indisponíveis: {exc}")
    state["triggered_reminders"] = triggered_reminders
    if state["changed"]:
        if nearest is not None:
            reminder_count = len(triggered_reminders)
            state["context_signal"] = {
                "kind": "ARRIVAL_REMINDER" if reminder_count else "ARRIVAL",
                "title": f"Chegada a {nearest['name']}",
                "message": (
                    triggered_reminders[0]["title"] if reminder_count == 1 else
                    f"{reminder_count} lembretes do Focus ficaram relevantes agora." if reminder_count > 1 else
                    f"O Focus foi priorizado para o contexto {nearest['name']}."
                ),
                "place_context": next_context,
            }
        elif previous.get("place_id") is not None:
            previous_name = previous.get("place_name") or previous.get("context") or "lugar conhecido"
            state["context_signal"] = {
                "kind": "DEPARTURE",
                "title": f"Saída de {previous_name}",
                "message": "O Buds atualizou o contexto e as prioridades do Focus.",
                "place_context": previous.get("context", "other"),
            }
    append_active_route_point(
        latitude,
        longitude,
        accuracy_m=accuracy,
        altitude_m=altitude_m,
        speed_mps=speed_mps,
        recorded_at=recorded_at,
    )
    return state


def set_semantic_context(context: str, source: str = "manual") -> dict[str, Any]:
    """Fallback manual para computadores sem permissão de geolocalização."""
    context = context if context in STATE_CONTEXTS else "unknown"
    source = source if source in SOURCES else "manual"
    previous = get_state()
    now = _now()
    with get_db_connection() as conn:
        conn.execute(
            """INSERT INTO location_state (id,place_id,context,status,source,updated_at)
               VALUES (1,NULL,?,? ,?,?) ON CONFLICT(id) DO UPDATE SET place_id=NULL,
               context=excluded.context,status=excluded.status,source=excluded.source,updated_at=excluded.updated_at""",
            (context, "manual" if context not in {"unknown", "away"} else context, source, now),
        )
        if previous.get("context") != context:
            conn.execute(
                "INSERT INTO location_events (place_id,event_type,context,source,created_at) VALUES (NULL,'context_changed',?,?,?)",
                (context, source, now),
            )
        conn.commit()
    return get_state()


def get_recent_events(limit: int = 30) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            """SELECT e.*, p.name AS place_name FROM location_events e
               LEFT JOIN location_places p ON p.id=e.place_id ORDER BY e.id DESC LIMIT ?""",
            (max(1, min(int(limit), 200)),),
        ).fetchall()
        return [dict(item) for item in rows]


def semantic_context_for_prompt() -> str:
    state = get_state()
    context = state.get("context", "unknown")
    lines: list[str] = []
    if context not in {"unknown", "away"}:
        label = state.get("place_name") or context
        lines.append(
            f"Contexto de lugar atual: {label} ({context}). Use apenas se for relevante; não mencione coordenadas."
        )
    active = get_active_route(include_points=False)
    recent = active or next(iter(list_routes(limit=1)), None)
    if recent:
        distance_km = float(recent.get("distance_m") or 0) / 1000
        duration_min = int(recent.get("duration_s") or 0) // 60
        state_label = "em gravação" if recent.get("status") == "active" else "concluído"
        lines.append(
            "Resumo local do trajeto mais recente (sem coordenadas): "
            f"{recent.get('name', 'Trajeto')}; {distance_km:.2f} km; "
            f"{duration_min} min; {state_label}."
        )
    return "\n".join(lines)


def _route_row(route_id: int, include_points: bool = False) -> Optional[dict[str, Any]]:
    with get_db_connection() as conn:
        row = conn.execute("SELECT * FROM location_routes WHERE id=?", (int(route_id),)).fetchone()
        if not row:
            return None
        route = dict(row)
        if include_points:
            points = conn.execute(
                "SELECT * FROM location_route_points WHERE route_id=? ORDER BY id",
                (int(route_id),),
            ).fetchall()
            route["points"] = [dict(point) for point in points]
        return route


def get_active_route(include_points: bool = True) -> Optional[dict[str, Any]]:
    with get_db_connection() as conn:
        row = conn.execute(
            "SELECT id FROM location_routes WHERE status='active' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return _route_row(int(row["id"]), include_points) if row else None


def get_route(route_id: int, include_points: bool = True) -> Optional[dict[str, Any]]:
    return _route_row(route_id, include_points)


def list_routes(limit: int = 20, include_points: bool = False) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM location_routes ORDER BY started_at DESC LIMIT ?",
            (max(1, min(int(limit), 100)),),
        ).fetchall()
        routes = [dict(row) for row in rows]
    if include_points:
        return [_route_row(route["id"], True) or route for route in routes]
    return routes


def route_dashboard(limit: int = 20) -> dict[str, Any]:
    active = get_active_route(include_points=True)
    routes = list_routes(limit=limit)
    if active:
        routes = [route for route in routes if route["id"] != active["id"]]
    return {"active": active, "routes": routes}


def start_route(name: Optional[str] = None) -> dict[str, Any]:
    active = get_active_route(include_points=True)
    if active:
        return active
    now = _now()
    clean_name = (name or f"Trajeto {datetime.now().strftime('%d/%m %H:%M')}").strip()[:80]
    with get_db_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO location_routes
               (name,status,started_at,ended_at,distance_m,duration_s,point_count,created_at)
               VALUES (?,'active',?,NULL,0,0,0,?)""",
            (clean_name or "Novo trajeto", now, now),
        )
        route_id = int(cursor.lastrowid)
        conn.commit()
    return _route_row(route_id, True) or {}


def append_active_route_point(
    latitude: float,
    longitude: float,
    *,
    accuracy_m: Optional[float] = None,
    altitude_m: Optional[float] = None,
    speed_mps: Optional[float] = None,
    recorded_at: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    latitude, longitude = _validate_coordinate(latitude, longitude)
    if accuracy_m is not None and float(accuracy_m) > 250:
        return get_active_route(include_points=False)
    recorded_at = (recorded_at or _now()).strip()
    with get_db_connection() as conn:
        route = conn.execute(
            "SELECT * FROM location_routes WHERE status='active' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not route:
            return None
        previous = conn.execute(
            "SELECT * FROM location_route_points WHERE route_id=? ORDER BY id DESC LIMIT 1",
            (route["id"],),
        ).fetchone()
        added_distance = 0.0
        if previous:
            added_distance = _distance_m(
                previous["latitude"], previous["longitude"], latitude, longitude
            )
            # Elimina ruído parado e saltos claramente inválidos de GPS.
            if added_distance < 4:
                return dict(route)
            if added_distance > 20_000:
                return dict(route)
        conn.execute(
            """INSERT INTO location_route_points
               (route_id,latitude,longitude,accuracy_m,altitude_m,speed_mps,recorded_at)
               VALUES (?,?,?,?,?,?,?)""",
            (
                route["id"], latitude, longitude,
                None if accuracy_m is None else float(accuracy_m),
                None if altitude_m is None else float(altitude_m),
                None if speed_mps is None or float(speed_mps) < 0 else float(speed_mps),
                recorded_at,
            ),
        )
        started = datetime.fromisoformat(str(route["started_at"]).replace("Z", "+00:00"))
        current = datetime.fromisoformat(recorded_at.replace("Z", "+00:00"))
        duration = max(0, int((current - started).total_seconds()))
        conn.execute(
            """UPDATE location_routes SET distance_m=distance_m+?, duration_s=?,
               point_count=point_count+1 WHERE id=?""",
            (added_distance, duration, route["id"]),
        )
        conn.commit()
        route_id = int(route["id"])
    return _route_row(route_id, False)


def finish_route() -> Optional[dict[str, Any]]:
    active = get_active_route(include_points=False)
    if not active:
        return None
    now = _now()
    started = datetime.fromisoformat(str(active["started_at"]).replace("Z", "+00:00"))
    ended = datetime.fromisoformat(now.replace("Z", "+00:00"))
    with get_db_connection() as conn:
        conn.execute(
            """UPDATE location_routes SET status='completed', ended_at=?, duration_s=?
               WHERE id=? AND status='active'""",
            (now, max(0, int((ended - started).total_seconds())), active["id"]),
        )
        conn.commit()
    return _route_row(active["id"], True)


def delete_route(route_id: int) -> bool:
    with get_db_connection() as conn:
        cursor = conn.execute("DELETE FROM location_routes WHERE id=?", (int(route_id),))
        conn.commit()
        return cursor.rowcount > 0
