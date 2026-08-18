import { supabase } from "./supabase";

/* ============================================================================
   § PLAYERS — the team roster, persists across games
   ========================================================================= */

export async function listPlayers() {
  const { data, error } = await supabase.from("players").select("*").order("jersey");
  if (error) throw error;
  return data.map((p) => ({ id: p.id, num: p.jersey, name: p.name }));
}

export async function addPlayer(jersey, name) {
  const { data, error } = await supabase
    .from("players")
    .insert({ jersey, name })
    .select()
    .single();
  if (error) throw error;
  return { id: data.id, num: data.jersey, name: data.name };
}

export async function clearRoster() {
  const { error } = await supabase.from("players").delete().not("id", "is", null);
  if (error) throw error;
}

/* ============================================================================
   § GAMES
   ========================================================================= */

// The one game currently in progress, if any — the app resumes it on load
// regardless of which browser/device that load happens on.
export async function findActiveGame() {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createGame({ opponent, homeAway = "home" }) {
  const { data, error } = await supabase
    .from("games")
    .insert({ opponent, home_away: homeAway })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateGameMeta(gameId, patch) {
  const row = { updated_at: new Date().toISOString() };
  if (patch.period !== undefined) row.period = String(patch.period);
  if (patch.keeper !== undefined) row.keeper = patch.keeper;
  if (patch.opponent !== undefined) row.opponent = patch.opponent;
  const { error } = await supabase.from("games").update(row).eq("id", gameId);
  if (error) throw error;
}

// Voids, never deletes — closes this game out so the next "start game" opens
// a fresh row instead of appending to a game that's already over.
export async function finalizeGame(gameId) {
  const { error } = await supabase
    .from("games")
    .update({ status: "final", updated_at: new Date().toISOString() })
    .eq("id", gameId);
  if (error) throw error;
}

/* ============================================================================
   § GAME ROSTER — the dressed list for one game, what the parser is
   constrained to (SPEC.md §1.3)
   ========================================================================= */

export async function listGameRoster(gameId) {
  const { data, error } = await supabase
    .from("game_roster")
    .select("jersey, dressed")
    .eq("game_id", gameId)
    .eq("dressed", true)
    .order("jersey");
  if (error) throw error;
  return data.map((r) => r.jersey);
}

export async function setGameRoster(gameId, entries) {
  const rows = entries.map((e) => ({
    game_id: gameId,
    player_id: e.playerId,
    jersey: e.jersey,
    dressed: e.dressed !== false,
  }));
  const { error } = await supabase
    .from("game_roster")
    .upsert(rows, { onConflict: "game_id,player_id" });
  if (error) throw error;
}

/* ============================================================================
   § STAT EVENTS — the append-only log
   ========================================================================= */

function fromRow(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    gameId: row.game_id,
    teamSide: row.team_side,
    jersey: row.jersey,
    statType: row.stat_type,
    derived: row.derived,
    parentId: row.parent_id,
    rawTranscript: row.raw_transcript,
    parseConfidence: row.parse_confidence,
    note: row.note,
    status: row.status,
    period: row.period,
    wallClock: row.wall_clock,
  };
}

export async function listEvents(gameId) {
  const { data, error } = await supabase
    .from("stat_events")
    .select("*")
    .eq("game_id", gameId)
    .order("ordinal");
  if (error) throw error;
  return data.map(fromRow);
}

export async function insertEvents(gameId, events) {
  const rows = events.map((e) => ({
    game_id: gameId,
    group_id: e.groupId,
    team_side: e.teamSide,
    jersey: e.jersey,
    stat_type: e.statType,
    derived: e.derived,
    parent_id: e.parentId || null,
    raw_transcript: e.rawTranscript,
    parse_confidence: e.parseConfidence,
    note: e.note || null,
    status: e.status,
    period: String(e.period),
  }));
  const { data, error } = await supabase.from("stat_events").insert(rows).select();
  if (error) throw error;
  return data.map(fromRow);
}

// The one mutation ever permitted on an existing row: flip status. The row
// and its original fields stay for audit.
export async function updateEventStatus(id, status) {
  const { error } = await supabase
    .from("stat_events")
    .update({ status, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function voidEventGroup(groupId) {
  const { error } = await supabase
    .from("stat_events")
    .update({ status: "void", edited_at: new Date().toISOString() })
    .eq("group_id", groupId);
  if (error) throw error;
}

export async function reassignEventGroupJersey(groupId, jersey) {
  const { error } = await supabase
    .from("stat_events")
    .update({ jersey, status: "committed", parse_confidence: 1, edited_at: new Date().toISOString() })
    .eq("group_id", groupId)
    .eq("team_side", "us");
  if (error) throw error;
}
