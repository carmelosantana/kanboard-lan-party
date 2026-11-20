<?php
namespace Kanboard\Plugin\LanParty\Schema;

const VERSION = 1;

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
}
