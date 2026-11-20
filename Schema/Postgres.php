<?php
namespace Kanboard\Plugin\LanParty\Schema;

const VERSION = 1;

function version_1($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS lanparty_scores (
        id SERIAL PRIMARY KEY,
        game_slug VARCHAR(32) NOT NULL,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score BIGINT NOT NULL,
        level VARCHAR(32) NULL,
        seed VARCHAR(64) NULL,
        meta TEXT NULL,
        created_at BIGINT NOT NULL
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS lanparty_scores_game_score_idx ON lanparty_scores(game_slug, score)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS lanparty_scores_user_game_idx ON lanparty_scores(user_id, game_slug)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS lanparty_saves (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_slug VARCHAR(32) NOT NULL,
        data TEXT,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY(user_id, game_slug)
    )');
}
