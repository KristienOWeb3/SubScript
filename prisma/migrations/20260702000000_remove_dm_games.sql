/* Remove the DM games feature (chess/checkers wagering).
   SubScript is a fintech platform; staked peer games promoted gambling and are gone:
   code, routes, contracts, keeper — and here, the data model. */

-- Game lifecycle DMs would render as orphaned generic bubbles; remove them with the feature.
delete from subscript_dms where message_type in ('GAME_INVITE', 'GAME_STARTED', 'GAME_RESULT');

alter table subscript_dms
    drop column if exists dm_game_id,
    drop column if exists game_event_key;

drop table if exists dm_game_moves;
drop table if exists dm_game_events;
drop table if exists dm_games;
