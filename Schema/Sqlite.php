<?php
namespace Kanboard\Plugin\LanParty\Schema;

const VERSION = 2;

function version_1($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS lanparty_scores (
        "id" INTEGER PRIMARY KEY,
        "game_slug" VARCHAR(32) NOT NULL,
        "user_id" INTEGER NOT NULL,
        "score" BIGINT NOT NULL,
        "level" VARCHAR(32) NULL,
        "seed" VARCHAR(64) NULL,
        "meta" TEXT NULL,
        "created_at" INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS lanparty_scores_game_score_idx ON lanparty_scores(game_slug, score)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS lanparty_scores_user_game_idx ON lanparty_scores(user_id, game_slug)');
    $pdo->exec('CREATE TABLE IF NOT EXISTS lanparty_saves (
        "user_id" INTEGER NOT NULL,
        "game_slug" VARCHAR(32) NOT NULL,
        "data" TEXT,
        "updated_at" INTEGER NOT NULL,
        PRIMARY KEY(user_id, game_slug),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )');
}

// Single-use run tokens: a score is accepted only with one (stored as a SHA-256 hash), at most one per player and game.
function version_2($pdo)
{
    $pdo->exec('CREATE TABLE IF NOT EXISTS lanparty_runs (
        "token_hash" CHAR(64) PRIMARY KEY,
        "user_id" INTEGER NOT NULL,
        "game_slug" VARCHAR(32) NOT NULL,
        "issued_at" INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )');
    $pdo->exec('CREATE INDEX IF NOT EXISTS lanparty_runs_user_idx ON lanparty_runs(user_id, issued_at)');
    $pdo->exec('CREATE UNIQUE INDEX IF NOT EXISTS lanparty_runs_user_game_idx ON lanparty_runs(user_id, game_slug)');
}
